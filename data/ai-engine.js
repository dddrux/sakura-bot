import fs from 'node:fs'
import path from 'node:path'
import { FairSemaphore } from './semaphore.js'
import { settings, readConfig, writeConfigSync } from './settings.js'
import { reply } from './reply.js'
import { sendMessageFast } from './send-manager.js'
import { getContextInfo } from './messages.js'
import {
  getAiGlobalConfig,
  getAiGroupConfig,
  releaseAiRequest,
  reserveAiRequest,
  updateAiGlobalConfig
} from './ai-store.js'
import { groqChat, resolveGroqModel } from './ai-client.js'
import { messageCallsSakura } from './ai-wake.js'
import { tryLocalCommandHelp } from './ai-command-guide.js'
import { isPlausibleAiToken } from './ai-token-utils.js'
import { aiFailurePolicy } from './ai-failure-policy.js'
export { messageCallsSakura } from './ai-wake.js'

const contexts = new Map()
const inflightChats = new Set()
const deferredRetries = new Map()
const globalSlots = new FairSemaphore(settings.aiConcurrency)
const warningTimes = new Map()
const userWarningTimes = new Map()
const configTokenState = new Map()

function configTokenRows(chat = '*') {
  const live = readConfig().ai?.tokens
  const tokens = Array.isArray(live) ? live : (Array.isArray(settings.aiTokens) ? settings.aiTokens : [])
  settings.aiTokens = tokens
  return tokens.map((entry, index) => {
    const object = typeof entry === 'object' && entry ? entry : { token: entry }
    const rawToken = String(object.token || object.value || '').trim()
    const scopeChat = String(object.scopeChat || object.scope || '*').trim() || '*'
    const id = `config-${index}`
    const state = configTokenState.get(id) || { cooldownUntil: 0, lastUsedAt: 0, failCount: 0 }
    return {
      id,
      label: String(object.label || `Config ${index + 1}`).slice(0, 50),
      rawToken,
      scopeChat,
      active: object.enabled !== false && isPlausibleAiToken(rawToken),
      ...state
    }
  }).filter(row => row.active && (row.scopeChat === '*' || row.scopeChat === chat))
}

function configTokenPool(chat = '*', excludeIds = [], now = Date.now()) {
  const excluded = new Set(excludeIds)
  return configTokenRows(chat)
    .filter(row => !excluded.has(row.id) && Number(row.cooldownUntil || 0) <= now)
    .sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0) || a.id.localeCompare(b.id))
}

function markConfigTokenSuccess(row) {
  if (!row?.id?.startsWith('config-')) return false
  configTokenState.set(row.id, { cooldownUntil: 0, lastUsedAt: Date.now(), failCount: 0 })
  return true
}

function markConfigTokenFailure(row, error = {}) {
  if (!row?.id?.startsWith('config-')) return false
  const previous = configTokenState.get(row.id) || { failCount: 0 }
  const failCount = Number(previous.failCount || 0) + 1
  const policy = aiFailurePolicy(error?.statusCode, error?.retryAfterMs)
  configTokenState.set(row.id, {
    cooldownUntil: policy.tokenCooldownMs > 0 ? Date.now() + policy.tokenCooldownMs : 0,
    lastUsedAt: Date.now(),
    failCount
  })
  return policy
}

function nextConfigAvailability(chat = '*', now = Date.now()) {
  const rows = configTokenRows(chat)
  if (!rows.length) return { waitMs: 0, count: 0 }
  const waitMs = Math.max(0, Math.min(...rows.map(row => Number(row.cooldownUntil || 0))) - now)
  return { waitMs, count: rows.length }
}
const personalityPath = path.join(settings.configDir, 'ai-personality.txt')

let cachedPersonality = ''
let cachedPersonalityAt = 0

const cleanText = (value, max = 1200) => String(value || '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

function digits(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function warnOnce(logger, key, details, message, intervalMs = 10 * 60_000) {
  const now = Date.now()
  if ((warningTimes.get(key) || 0) > now) return
  warningTimes.set(key, now + intervalMs)
  logger?.warn?.(details, message)
}

async function notifyAiUnavailable(sock, msg, chat, { kind = 'no-token', waitMs = 0, force = false, detail = '' } = {}) {
  const key = `${chat}:${kind}`
  const now = Date.now()
  if (!force && (userWarningTimes.get(key) || 0) > now) return false
  userWarningTimes.set(key, now + 60_000)
  const seconds = Math.max(1, Math.ceil(Number(waitMs || 0) / 1000))
  const text = kind === 'no-token'
    ? `💮 A IA está sem tokens válidos agora. O dono precisa usar ${settings.prefix}iatoken add TOKEN e depois ${settings.prefix}iatoken test.`
    : kind === 'cooldown'
      ? `💮 A IA está sem tokens disponíveis neste momento.${waitMs > 0 ? ` Tente novamente em cerca de ${seconds}s.` : ''}`
      : kind === 'provider-config'
        ? `💮 A IA recebeu erro de configuração da Groq${detail ? `: ${cleanText(detail, 180)}` : '.'} Use ${settings.prefix}iatoken test e ${settings.prefix}iaconfig modelos.`
        : `💮 A IA está temporariamente indisponível. Use ${settings.prefix}iatoken test para verificar os tokens.`
  await reply(sock, msg, text, { title: kind === 'no-token' ? 'IA SEM TOKENS' : 'IA INDISPONÍVEL' }).catch(() => {})
  return true
}

function defaultPersonality() {
  const now = Date.now()
  if (cachedPersonality && now - cachedPersonalityAt < 60_000) return cachedPersonality
  try { cachedPersonality = fs.readFileSync(personalityPath, 'utf8').trim() } catch {
    cachedPersonality = 'Você é Sakura, uma bot brasileira de WhatsApp. Responda em português brasileiro de forma breve, natural e útil.'
  }
  cachedPersonalityAt = now
  return cachedPersonality
}

function botJids(sock) {
  return [sock?.user?.id, sock?.user?.lid].filter(Boolean).map(String)
}

function quotedBot(sock, msg) {
  const context = getContextInfo(msg?.message)
  const quoted = [context?.participant, context?.participantAlt].filter(Boolean).map(String)
  const bots = botJids(sock)
  const botNumbers = new Set(bots.map(digits).filter(Boolean))
  return quoted.some(jid => bots.includes(jid) || botNumbers.has(digits(jid)))
}

function shouldWake({ sock, msg, text, isGroup, mentionedBot, mode }) {
  if (!isGroup) return true
  if (mode === 'all') return true
  if (mentionedBot || quotedBot(sock, msg)) return true
  return messageCallsSakura(text)
}

function contextKey(chat = '') {
  return String(chat || '').slice(0, 180)
}

function addContext(chat, item, config) {
  const key = contextKey(chat)
  if (!key) return
  const current = contexts.get(key) || []
  current.push(item)
  const maxMessages = Math.max(1, Number(config.maxContextMessages) || 6)
  while (current.length > maxMessages) current.shift()
  while (current.reduce((sum, entry) => sum + entry.content.length, 0) > Math.max(500, Number(config.maxContextChars) || 3500) && current.length > 1) current.shift()
  contexts.set(key, current)
  if (contexts.size > 150) contexts.delete(contexts.keys().next().value)
}

function buildMessages(chat, currentText, senderNumber, senderName, config) {
  const personality = cleanText(config.systemPrompt || defaultPersonality(), 8000)
  const history = (contexts.get(contextKey(chat)) || []).slice(-(Number(config.maxContextMessages) || 6))
  const messages = [
    { role: 'system', content: personality },
    ...history.map(entry => ({ role: entry.role, content: entry.content }))
  ]
  const label = cleanText(senderName, 50) || `usuário ${String(senderNumber || '').slice(-4)}`
  messages.push({ role: 'user', content: `${label}: ${cleanText(currentText, 1200)}` })
  return messages
}

function safeAiText(value = '') {
  return cleanText(value, 1800).replace(/(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g, '[segredo removido]')
}

export function formatAiReply(value = '') {
  return safeAiText(value)
}

async function sendAiReply(sock, msg, value = '') {
  const body = formatAiReply(value)
  if (!body) return null
  // O footer do InteractiveMessage é renderizado pelo WhatsApp em texto menor
  // e cinza. nativeFlow vazio mantém a resposta sem botões/CTAs visíveis.
  return sendMessageFast(sock, msg.key.remoteJid, {
    text: body,
    footer: 'mensagem gerada por IA',
    nativeFlow: [],
    viewOnce: true,
    interactiveAsTemplate: false
  }, { quoted: msg })
}

function retryKey(chat, msg) {
  return `${chat}:${String(msg?.key?.id || cleanText(msg?.messageTimestamp, 40) || 'mensagem')}`
}

function scheduleDeferredRetry(payload, waitMs, logger) {
  const retryDepth = Number(payload.retryDepth) || 0
  const boundedWait = Math.max(1_000, Math.ceil(Number(waitMs) || 0) + Math.floor(Math.random() * 1_500))
  if (retryDepth >= settings.aiDeferredRetryLimit || boundedWait > settings.aiMaxDeferredRetryMs) return false
  const key = retryKey(payload.msg?.key?.remoteJid || payload.numbers?.chat || '', payload.msg)
  if (deferredRetries.has(key)) return true
  const timer = setTimeout(() => {
    deferredRetries.delete(key)
    void maybeHandleAi({ ...payload, retryDepth: retryDepth + 1 }).catch(error => {
      logger?.warn?.({ error, stage: 'ai-deferred-retry', chat: payload.numbers?.chat }, 'nova tentativa adiada da IA falhou')
    })
  }, boundedWait)
  timer.unref?.()
  deferredRetries.set(key, timer)
  logger?.info?.({ stage: 'ai-deferred', waitMs: boundedWait, retryDepth: retryDepth + 1, chat: payload.numbers?.chat }, 'IA aguardará a liberação automática do próximo token')
  return true
}

export async function maybeHandleAi({ sock, msg, text, numbers, logger, isGroup = false, mentionedBot = false, retryDepth = 0, commands = null, force = false, notifyFailure = false } = {}) {
  if (await tryLocalCommandHelp({ sock, msg, text, commands, logger })) return { handled: true, reason: 'local-command-help' }
  const storedGlobal = getAiGlobalConfig()
  const global = { ...storedGlobal, globalEnabled: settings.aiEnabled && storedGlobal.globalEnabled !== false, model: storedGlobal.model || settings.aiModel }
  if (!settings.aiEnabled || !global.globalEnabled) return { handled: false, reason: 'global-off' }
  if (!isGroup && !global.privateEnabled) return { handled: false, reason: 'private-off' }

  const chat = msg?.key?.remoteJid || numbers?.chat || ''
  const senderNumber = numbers?.sender || ''
  const clean = cleanText(text, 1200)
  if (!chat || !senderNumber || !clean) return { handled: false, reason: 'empty' }

  const group = isGroup ? getAiGroupConfig(chat) : {
    enabled: true,
    mode: 'all',
    cooldownMs: 8000,
    dailyLimit: 80
  }
  if (isGroup && !group.enabled && !force) return { handled: false, reason: 'group-off' }

  const wake = force || shouldWake({ sock, msg, text: clean, isGroup, mentionedBot, mode: group.mode })
  if (!wake) {
    addContext(chat, { role: 'user', content: `${cleanText(msg?.pushName, 50) || 'usuário'}: ${clean}` }, global)
    return { handled: false, reason: 'not-addressed' }
  }
  if (inflightChats.has(chat)) return { handled: false, reason: 'busy' }

  const tokenScope = isGroup ? chat : '*'
  const configuredRows = configTokenRows(tokenScope)
  if (!configuredRows.length) {
    warnOnce(logger, 'ai-key', { stage: 'ai', reason: 'config-empty' }, 'IA sem token configurado no arquivo único')
    await notifyAiUnavailable(sock, msg, chat, { kind: 'no-token', force: notifyFailure || force })
    return { handled: false, reason: 'key-unavailable' }
  }

  const firstToken = configTokenPool(tokenScope)[0]
  if (!firstToken) {
    const configNext = nextConfigAvailability(tokenScope)
    const nextWaitMs = Number(configNext.waitMs) || 0
    const scheduled = nextWaitMs > 0 && scheduleDeferredRetry({ sock, msg, text: clean, numbers, logger, isGroup, mentionedBot, retryDepth, commands }, nextWaitMs, logger)
    if (!scheduled) warnOnce(logger, `ai-no-token:${tokenScope}`, { stage: 'ai', reason: nextWaitMs ? 'cooldown-too-long' : 'pool-empty' }, 'IA temporariamente sem token válido para esta conversa')
    await notifyAiUnavailable(sock, msg, chat, { kind: 'cooldown', waitMs: nextWaitMs, force: notifyFailure || force })
    return { handled: false, reason: scheduled ? 'deferred' : 'no-token', remainingMs: nextWaitMs }
  }

  const reservation = reserveAiRequest(chat, {
    cooldownMs: group.cooldownMs,
    dailyLimit: group.dailyLimit
  })
  if (!reservation.allowed) return { handled: false, reason: reservation.reason, remainingMs: reservation.remainingMs }

  inflightChats.add(chat)
  const releaseSlot = await globalSlots.acquire()
  const excluded = []
  let delivered = false
  let terminalFailure = null
  try {
    const messages = buildMessages(chat, clean, senderNumber, msg?.pushName || '', global)
    const availableCount = configuredRows.length
    const maxAttempts = Math.max(1, Math.min(settings.aiRotationMaxAttempts, availableCount || 1))
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const tokenRow = attempt === 0
        ? firstToken
        : configTokenPool(tokenScope, excluded)[0]
      if (!tokenRow) break
      excluded.push(tokenRow.id)
      let token = tokenRow.rawToken
      let result
      try {
        result = await groqChat({
          token,
          model: global.model,
          messages,
          timeoutMs: global.timeoutMs,
          maxOutputTokens: global.maxOutputTokens,
          temperature: global.temperature
        })
        markConfigTokenSuccess(tokenRow)
      } catch (initialError) {
        let error = initialError
        const initialStatusCode = Number(error?.statusCode) || 0

        // 404/400/422 normalmente indicam modelo/configuração, não token ruim.
        // Consulta os modelos que ESTE token realmente enxerga e refaz uma vez.
        if ([400, 404, 422].includes(initialStatusCode)) {
          try {
            const preferred = [
              global.model,
              settings.aiModel,
              ...(Array.isArray(settings.aiModels) ? settings.aiModels.map(item => item?.id) : [])
            ]
            const fallbackModel = await resolveGroqModel(token, '', {
              preferred: preferred.filter(model => model && model !== global.model),
              exclude: [global.model],
              timeoutMs: Math.min(8000, global.timeoutMs),
              forceRefresh: true
            })
            if (fallbackModel.model && fallbackModel.model !== global.model) {
              const previousModel = global.model
              global.model = fallbackModel.model
              settings.aiModel = fallbackModel.model
              updateAiGlobalConfig({ model: fallbackModel.model })
              try {
                const current = readConfig()
                writeConfigSync({ ai: { ...current.ai, model: fallbackModel.model } })
              } catch {}
              logger?.warn?.({
                stage: 'ai-model-fallback',
                previousModel,
                fallbackModel: fallbackModel.model,
                availableModels: fallbackModel.available.length,
                chat: numbers?.chat || chat
              }, 'modelo da IA indisponível; Sakura selecionou automaticamente um modelo permitido')
              result = await groqChat({
                token,
                model: fallbackModel.model,
                messages,
                timeoutMs: global.timeoutMs,
                maxOutputTokens: global.maxOutputTokens,
                temperature: global.temperature
              })
              markConfigTokenSuccess(tokenRow)
              error = null
            } else if (!fallbackModel.model) {
              error = Object.assign(new Error('Nenhum modelo de conversa está disponível para este token/projeto Groq.'), {
                statusCode: initialStatusCode,
                code: 'GROQ_NO_CHAT_MODEL'
              })
            }
          } catch (fallbackError) {
            error = fallbackError
          }
        }

        if (error) {
          const statusCode = Number(error?.statusCode) || initialStatusCode
          const failure = {
            statusCode,
            retryAfterMs: Number(error?.retryAfterMs) || 0,
            code: error?.code || 'GROQ_FAILURE'
          }
          const policy = markConfigTokenFailure(tokenRow, failure)
          logger?.warn?.({
            stage: 'ai-request',
            statusCode,
            errorCode: error?.code || 'GROQ_FAILURE',
            attempt: attempt + 1,
            model: global.model,
            scope: tokenRow.scopeChat === '*' ? 'global' : 'grupo',
            chat: numbers?.chat || chat,
            policy: policy?.kind
          }, policy?.rotateToken ? 'token da IA falhou e foi colocado em rotação segura' : 'requisição da IA falhou sem relação com rotação de token')
          token = ''
          if (!policy?.rotateToken) {
            terminalFailure = { statusCode, kind: policy?.kind || 'provider-error', detail: error?.message || error?.code || '' }
            break
          }
          continue
        }
      }
      token = ''
      const responseText = safeAiText(result.text)
      if (!responseText) {
        logger?.warn?.({ stage: 'ai-response-empty', chat: numbers?.chat || chat }, 'resposta da IA ficou vazia após sanitização')
        break
      }
      try {
        await sendAiReply(sock, msg, responseText)
      } catch (error) {
        logger?.warn?.({ error, stage: 'ai-send', chat: numbers?.chat || chat }, 'resposta gerada, mas não enviada ao WhatsApp')
        break
      }
      addContext(chat, { role: 'user', content: `${cleanText(msg?.pushName, 50) || 'usuário'}: ${clean}` }, global)
      addContext(chat, { role: 'assistant', content: responseText }, global)
      delivered = true
      logger?.info?.({
        stage: 'ai-response',
        chat: numbers?.chat || chat,
        sender: senderNumber,
        model: result.model,
        attempt: attempt + 1,
        tokenScope: tokenRow.scopeChat === '*' ? 'global' : 'grupo',
        inputTokens: Number(result.usage?.prompt_tokens) || 0,
        outputTokens: Number(result.usage?.completion_tokens) || 0,
        queue: globalSlots.snapshot()
      }, 'resposta da IA enviada')
      break
    }
    if (!delivered) {
      releaseAiRequest(chat, reservation)
      if (terminalFailure) {
        await notifyAiUnavailable(sock, msg, chat, {
          kind: terminalFailure.kind === 'provider-config' ? 'provider-config' : 'provider-error',
          force: notifyFailure || force,
          detail: terminalFailure.detail
        })
        return { handled: false, reason: 'provider-error', statusCode: terminalFailure.statusCode }
      }
      const configNext = nextConfigAvailability(tokenScope)
      const nextWaitMs = Number(configNext.waitMs) || 0
      const scheduled = nextWaitMs > 0 && scheduleDeferredRetry({ sock, msg, text: clean, numbers, logger, isGroup, mentionedBot, retryDepth, commands }, nextWaitMs, logger)
      warnOnce(logger, `ai-pool-exhausted:${tokenScope}`, { stage: 'ai', attempts: excluded.length, scheduled, waitMs: nextWaitMs }, scheduled ? 'Todos os tokens atingiram limite; a IA tentará novamente automaticamente' : 'IA temporariamente sem token utilizável')
      await notifyAiUnavailable(sock, msg, chat, { kind: 'cooldown', waitMs: nextWaitMs, force: notifyFailure || force })
      return { handled: false, reason: scheduled ? 'deferred' : 'failed', remainingMs: nextWaitMs }
    }
    return { handled: true, reason: 'sent' }
  } finally {
    inflightChats.delete(chat)
    releaseSlot()
  }
}

export function clearAiContext(chat = '') {
  if (chat) return contexts.delete(contextKey(chat))
  contexts.clear()
  return true
}

export function clearAiDeferredRetries() {
  for (const timer of deferredRetries.values()) clearTimeout(timer)
  deferredRetries.clear()
}

export function aiEngineStatus() {
  return { inflightChats: inflightChats.size, contexts: contexts.size, deferredRetries: deferredRetries.size, configTokens: configTokenRows('*').length, queue: globalSlots.snapshot() }
}
