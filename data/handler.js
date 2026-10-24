import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isConfiguredOwner, settings } from './settings.js'
import {
  matchAudioTrigger,
  matchStickerTrigger,
  getStickerTriggerBuffer,
  getTriggerStats,
  warmTriggerCaches
} from './triggers.js'
import { prepareLegacyAudio } from './legacy-audio.js'
import { recordActivity, recordCommand } from './economy.js'
import {
  getContextInfo,
  getMessageText,
  getMessageType,
  getSelectionDetails,
  normalizeCommandText,
  normalizeTriggerText
} from './messages.js'
import { resolveMessageNumbers, resolveNumber } from './jid.js'
import { reply } from './reply.js'
import { buildCommandNotFound } from './formatter.js'
import { runtimeSettings } from './runtime.js'
import { triggerDispatcher } from './trigger-dispatcher.js'
import { hasActiveRental } from './rentals.js'
import { SHORT_ALIAS_TARGETS, canonicalShortTarget, ensureShortAliases } from './short-aliases.js'
import { isSubowner, rememberUser } from './core-store.js'
import { rememberRecentStickerMedia } from './sticker-batch-cache.js'
import { getRandomSticker } from './sticker-library.js'
import { maybeHandleAi, messageCallsSakura } from './ai-engine.js'
import { maybeQueueAutoTikTok, maybeQueueAutoSocial } from './group-automations.js'
import { maybeQueueAutoDownload } from './auto-download.js'
import { checkCommandFlood } from './automation-store.js'
import { maybeEnforceAntiLink } from './anti-link.js'
import { enforcePrivateMessageProtection } from './private-protection.js'
import { isVip } from './vip.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from './sticker-metadata.js'
import { groupDisplayName } from './user-display.js'
import { normalizeCommandDefinition, reactToCommand, workstationContext } from './workstation.js'
import { withSendPriority } from './send-manager.js'
import { connectedSelfNumber, isConnectedSelf, shouldProcessOwnMessage } from './superuser.js'
import { setCommandOfficialLinks, clearCommandOfficialLinks } from './command-ui-state.js'
import { resolveCommandCorrection } from './command-correction.js'
import { buildReceptionModel, getReceptionGate } from './reception.js'
import { evaluateAutoMedia } from './auto-media-balance.js'
import {
  buildAfkNoticeText,
  buildAfkReturnedText,
  getAfk,
  removeAfk
} from './afk.js'

let commandCache
const processedIds = new Map()
const afkNoticeCooldown = new Map()
const AFK_NOTICE_COOLDOWN_MS = 8_000
const triggerCooldowns = new Map()
const recentAutoStickerHashes = new Map()

function normalizeCommandKey(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

function messageTimestampMs(msg = {}) {
  const raw = msg?.messageTimestamp
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000
  if (typeof raw === 'bigint') return Number(raw) * 1000
  if (raw && typeof raw.toNumber === 'function') return raw.toNumber() * 1000
  if (raw && Number.isFinite(Number(raw.low))) return Number(raw.low) * 1000
  return 0
}

function jidDigits(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function messageMentionsBot(sock, msg) {
  const context = getContextInfo(msg?.message)
  const mentioned = [
    ...(Array.isArray(context?.mentionedJid) ? context.mentionedJid : []),
    ...(Array.isArray(context?.mentionedJids) ? context.mentionedJids : [])
  ].filter(Boolean).map(String)
  const botJids = [sock?.user?.id, sock?.user?.lid].filter(Boolean).map(String)
  const botDigits = new Set(botJids.map(jidDigits).filter(Boolean))
  return mentioned.some(jid => botJids.includes(jid) || botDigits.has(jidDigits(jid)))
}

function rememberAutoStickerHash(chat = '', hash = '', limit = 4) {
  if (!chat || !hash) return
  const current = recentAutoStickerHashes.get(chat) || []
  const next = [hash, ...current.filter(item => item !== hash)].slice(0, Math.max(1, Number(limit) || 4))
  recentAutoStickerHashes.set(chat, next)
  if (recentAutoStickerHashes.size > 500) recentAutoStickerHashes.delete(recentAutoStickerHashes.keys().next().value)
}

function reserveTrigger(chat, kind, entry, now = Date.now()) {
  const key = `${chat}:${kind}:${entry?.id || 'unknown'}`
  const expiresAt = triggerCooldowns.get(key) || 0
  if (expiresAt > now) return { allowed: false, remainingMs: expiresAt - now }
  const cooldownMs = Math.max(0, Number(entry?.cooldownMs) || settings.autoTriggerCooldownMs)
  triggerCooldowns.set(key, now + cooldownMs)
  if (triggerCooldowns.size > 1000) {
    for (const [itemKey, expiry] of triggerCooldowns) if (expiry <= now) triggerCooldowns.delete(itemKey)
  }
  return { allowed: true, remainingMs: 0 }
}


function commandFloodCost(command = {}) {
  if (Number.isFinite(Number(command.antifloodCost))) return Math.max(1, Math.min(10, Math.round(Number(command.antifloodCost))))
  const name = String(command.name || '').toLowerCase()
  if (['s20', 'figvip', 'brat', 'tiktok', 'play', 'player'].includes(name)) return 4
  if (['s', 'take', 'figsorteio', 'cita'].includes(name)) return 2
  if (command.ownerOnly || command.adminOnly) return 2
  return 1
}

function compactDuration(ms = 0) {
  const seconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  return `${Math.ceil(minutes / 60)}h`
}

function rememberMessageId(id) {
  if (!id) return false
  if (processedIds.has(id)) return true
  processedIds.set(id, Date.now())
  if (processedIds.size > 1000) processedIds.delete(processedIds.keys().next().value)
  return false
}

function pruneAfkCooldown(now = Date.now()) {
  if (afkNoticeCooldown.size < 500) return
  for (const [key, expiresAt] of afkNoticeCooldown) {
    if (expiresAt <= now) afkNoticeCooldown.delete(key)
  }
}

function canSendAfkNotice(chat, number, now = Date.now()) {
  const key = `${chat}:${number}`
  if ((afkNoticeCooldown.get(key) || 0) > now) return false
  afkNoticeCooldown.set(key, now + AFK_NOTICE_COOLDOWN_MS)
  pruneAfkCooldown(now)
  return true
}

function isAfkCommandText(text = '') {
  const value = String(text || '').trim()
  if (!value.startsWith(settings.prefix)) return false
  const command = value.slice(settings.prefix.length).trim().split(/\s+/, 1)[0]?.toLocaleLowerCase('pt-BR')
  return command === 'afk' || command === 'ausente'
}

function collectReferencedJids(message = {}) {
  const context = getContextInfo(message)
  if (!context) return []
  const mentioned = [
    ...(Array.isArray(context.mentionedJid) ? context.mentionedJid : []),
    ...(Array.isArray(context.mentionedJids) ? context.mentionedJids : [])
  ]
  const quoted = context.quotedMessage || context.stanzaId
    ? [context.participant, context.participantAlt]
    : []
  return [...new Set([...mentioned, ...quoted].filter(Boolean).map(String))]
}

function senderMentionJid(msg, senderNumber) {
  return msg?.key?.participantAlt || msg?.key?.participant || `${senderNumber}@s.whatsapp.net`
}

async function handleAfkPresence(sock, msg, numbers, text, logger, { skipReferences = false } = {}) {
  if (!msg.key.remoteJid?.endsWith('@g.us') || !numbers.sender || !numbers.chat) return
  if (isAfkCommandText(text)) {
    logger.debug({ chat: numbers.chat, sender: numbers.sender, stage: 'afk-presence', action: 'skip-command' }, 'verificação AFK ignorou o próprio comando')
    return
  }

  const startedAt = Date.now()
  try {
    const removed = await removeAfk(numbers.chat, numbers.sender)
    if (removed) {
      const mention = senderMentionJid(msg, numbers.sender)
      await reply(sock, msg, buildAfkReturnedText(numbers.sender, removed), { mentions: [mention], title: 'MODO AFK' })
      logger.success({
        chat: numbers.chat,
        sender: numbers.sender,
        action: 'afk-auto-disabled',
        durationMs: Date.now() - removed.since,
        executionMs: Date.now() - startedAt
      }, 'AFK desativado automaticamente por nova mensagem')
    }

    if (skipReferences) {
      logger.debug({ chat: numbers.chat, sender: numbers.sender, stage: 'afk-presence', action: 'skip-references-fast-path', executionMs: Date.now() - startedAt }, 'referências AFK ignoradas pelo caminho rápido do comando')
      return
    }

    const referencedJids = collectReferencedJids(msg.message)
    if (!referencedJids.length) {
      logger.debug({ chat: numbers.chat, sender: numbers.sender, stage: 'afk-presence', referenced: 0, executionMs: Date.now() - startedAt }, 'mensagem sem referência AFK')
      return
    }

    const notices = []
    const mentions = []
    const seenNumbers = new Set()
    for (const referenceJid of referencedJids) {
      const referencedNumber = await resolveNumber(sock, referenceJid)
      if (!referencedNumber || referencedNumber === numbers.sender || seenNumbers.has(referencedNumber)) continue
      seenNumbers.add(referencedNumber)
      const record = await getAfk(numbers.chat, referencedNumber)
      if (!record || !canSendAfkNotice(numbers.chat, referencedNumber)) continue
      notices.push(record)
      mentions.push(record.jid || referenceJid || `${referencedNumber}@s.whatsapp.net`)
    }

    logger.debug({
      chat: numbers.chat,
      sender: numbers.sender,
      stage: 'afk-presence',
      referenced: referencedJids.length,
      notices: notices.length,
      executionMs: Date.now() - startedAt
    }, 'referências AFK verificadas')

    if (!notices.length) return
    await reply(sock, msg, buildAfkNoticeText(notices), { mentions: [...new Set(mentions)], title: 'USUÁRIO AFK' })
    logger.info({
      chat: numbers.chat,
      sender: numbers.sender,
      action: 'afk-notice',
      referenced: referencedJids.length,
      notices: notices.length,
      executionMs: Date.now() - startedAt
    }, 'aviso de usuário AFK enviado')
  } catch (error) {
    logger.warn({ error, chat: numbers.chat, sender: numbers.sender, stage: 'afk-presence', executionMs: Date.now() - startedAt }, 'falha recuperável no sistema AFK')
  }
}

export async function loadCommands(logger) {
  if (commandCache) return commandCache
  const startedAt = Date.now()
  const commands = new Map()
  const files = (await fs.readdir(settings.commandsDir)).filter(file => file.endsWith('.js')).sort()
  logger.debug({ stage: 'command-discovery', count: files.length, file: settings.commandsDir }, 'arquivos de comando encontrados')
  const loaded = await Promise.all(files.map(async file => {
    const importStartedAt = Date.now()
    try {
      const moduleUrl = pathToFileURL(path.join(settings.commandsDir, file)).href
      const command = normalizeCommandDefinition((await import(moduleUrl)).default)
      logger.debug({ file, command: command?.name, category: command?.category, executionMs: Date.now() - importStartedAt }, 'módulo de comando importado')
      return { file, command }
    } catch (error) {
      logger.error({ error, file, executionMs: Date.now() - importStartedAt }, 'falha ao carregar comando')
      return null
    }
  }))
  for (const item of loaded) {
    if (!item) continue
    const { file, command } = item
    if (!command?.name || typeof command.execute !== 'function') {
      logger.warn({ file }, 'arquivo de comando ignorado')
      continue
    }
    commands.set(command.name.toLowerCase(), command)
    for (const alias of command.aliases || []) commands.set(String(alias).toLowerCase(), command)
    logger.debug({
      file,
      command: command.name,
      aliases: (command.aliases || []).join(','),
      category: command.category,
      isGroup: Boolean(command.groupOnly),
      isAdmin: Boolean(command.adminOnly)
    }, 'comando registrado')
  }

  for (const [alias, target] of Object.entries(SHORT_ALIAS_TARGETS)) {
    const command = commands.get(String(target).toLowerCase())
    if (!command) {
      logger.warn({ alias, command: target, stage: 'short-alias' }, 'atalho curto ignorado porque a ação não existe')
      continue
    }
    const existing = commands.get(alias)
    if (existing && existing !== command) {
      logger.warn({ alias, command: target, stage: 'short-alias', existing: existing.name }, 'atalho curto em conflito foi ignorado')
      continue
    }
    commands.set(alias, command)
  }
  const generatedShortAliases = ensureShortAliases(commands)
  logger.debug({ stage: 'short-alias-auto', generated: generatedShortAliases.length }, 'aliases curtos automáticos preparados')
  commandCache = commands
  logger.debug({ stage: 'command-cache', count: new Set([...commands.values()]).size, aliases: commands.size, durationMs: Date.now() - startedAt }, 'cache de comandos preparado')
  return commands
}

async function runTriggers(sock, msg, normalizedText, logger, context = {}) {
  const runtime = runtimeSettings()
  const matchContext = {
    isGroup: Boolean(context.isGroup),
    mentionedBot: Boolean(context.mentionedBot),
    chat: context.chat || msg.key.remoteJid,
    sender: context.sender || msg.key.participant || msg.key.remoteJid
  }
  let audioMatch = runtime.autoReplyAudio ? matchAudioTrigger(normalizedText, matchContext) : null
  let stickerMatch = runtime.autoReplySticker ? matchStickerTrigger(normalizedText, matchContext) : null
  const combined = Boolean(audioMatch && stickerMatch && audioMatch.matched === stickerMatch.matched)
  if (audioMatch || stickerMatch) {
    const balance = evaluateAutoMedia({
      chat: msg.key.remoteJid,
      audioId: audioMatch?.value?.id || '',
      stickerId: stickerMatch?.value?.id || '',
      audio: Boolean(audioMatch),
      sticker: Boolean(stickerMatch),
      combined
    })
    if (!balance.audio) audioMatch = null
    if (!balance.sticker) stickerMatch = null
    if (!audioMatch && !stickerMatch) {
      logger?.debug?.({ stage: 'auto-media-balance', reason: balance.reason, chat: msg.key.remoteJid }, 'IA local equilibrou resposta automática e suprimiu mídia repetitiva')
      return false
    }
    logger?.debug?.({ stage: 'auto-media-balance', reason: balance.reason, audio: Boolean(audioMatch), sticker: Boolean(stickerMatch), chat: msg.key.remoteJid }, 'IA local equilibrou respostas automáticas')
  }

  const effectiveCombined = Boolean(audioMatch && stickerMatch && audioMatch.matched === stickerMatch.matched)
  let audioReservation = null
  let stickerReservation = null
  let comboReservation = null
  if (effectiveCombined) {
    comboReservation = reserveTrigger(msg.key.remoteJid, 'combo', {
      id: `${audioMatch.value.id}+${stickerMatch.value.id}`,
      cooldownMs: Math.max(Number(audioMatch.value.cooldownMs) || 0, Number(stickerMatch.value.cooldownMs) || 0)
    })
  } else {
    audioReservation = audioMatch ? reserveTrigger(msg.key.remoteJid, 'audio', audioMatch.value) : null
    stickerReservation = stickerMatch ? reserveTrigger(msg.key.remoteJid, 'sticker', stickerMatch.value) : null
  }

  const audioAllowed = Boolean(audioMatch && (effectiveCombined ? comboReservation?.allowed : audioReservation?.allowed))
  const stickerAllowed = Boolean(stickerMatch && (effectiveCombined ? comboReservation?.allowed : stickerReservation?.allowed))
  if (!audioAllowed && !stickerAllowed) return false

  const dispatchMode = effectiveCombined ? 'ordered-sticker-audio' : 'queued-independent'
  logger.debug({
    stage: 'trigger-match',
    textPreview: normalizedText.slice(0, 100),
    audio: Boolean(audioMatch),
    sticker: Boolean(stickerMatch),
    combined: effectiveCombined,
    dispatchMode,
    audioId: audioMatch?.value?.id,
    stickerId: stickerMatch?.value?.id,
    audioPhrase: audioMatch?.matched,
    stickerPhrase: stickerMatch?.matched,
    mentionedBot: matchContext.mentionedBot,
    messageAgeMs: Number(context.messageAgeMs) || 0,
    queue: triggerDispatcher.snapshot()
  }, 'resposta automática colocada na fila de mídia')

  const chat = msg.key.remoteJid
  const queued = triggerDispatcher.enqueue(chat, async ({ queueWaitMs, snapshot }) => {
    const preparationStartedAt = Date.now()
    const stickerUserName = String(context.userName || msg.pushName || 'Usuário').trim()
    const stickerGroupName = stickerAllowed ? await groupDisplayName(sock, chat, context.metadata || null) : 'Conversa privada'
    const stickerDescription = stickerAllowed ? buildSakuraStickerDescription({ userName: stickerUserName, groupName: stickerGroupName }) : ''
    const audioPreparation = audioAllowed
      ? (async () => {
          const audio = audioMatch.value
          const buffer = audio.legacy ? await prepareLegacyAudio(audio.file, logger) : await fs.readFile(audio.file)
          return { buffer, audio }
        })()
      : Promise.resolve(null)
    const stickerPreparation = stickerAllowed
      ? (async () => {
          const chance = Math.max(0, Math.min(1, Number(runtime.autoStickerLibraryChance) || 0))
          if (runtime.autoStickerRandom && chance > 0 && Math.random() < chance) {
            const selected = await getRandomSticker({
              chat,
              excludeHashes: recentAutoStickerHashes.get(chat) || [],
              allowCrossChat: false
            })
            if (selected) {
              return {
                sticker: addSakuraStickerMetadata(selected.buffer, { userName: stickerUserName, description: stickerDescription }),
                entry: { ...stickerMatch.value, id: `library:${selected.hash}` },
                randomHash: selected.hash,
                randomLibrary: true
              }
            }
          }
          return {
            sticker: await getStickerTriggerBuffer(stickerMatch.value, runtime.stickerMetadata !== false, { userName: stickerUserName, groupName: stickerGroupName }),
            entry: stickerMatch.value,
            randomHash: '',
            randomLibrary: false
          }
        })()
      : Promise.resolve(null)

    const [audioPrepared, stickerPrepared] = await Promise.allSettled([audioPreparation, stickerPreparation])
    const results = []

    const sendSticker = async () => {
      if (stickerPrepared.status === 'rejected') {
        logger.warn({
          error: stickerPrepared.reason,
          trigger: stickerMatch?.matched,
          triggerId: stickerMatch?.value?.id,
          file: stickerMatch?.value?.relativeFile,
          chat,
          stage: 'trigger-prepare-sticker',
          combined,
          queueWaitMs
        }, 'falha recuperável ao preparar figurinha automática')
        return
      }
      if (!stickerPrepared.value) return
      const { sticker, entry, randomHash, randomLibrary } = stickerPrepared.value
      const startedAt = Date.now()
      await sock.sendMessage(chat, { sticker }, { quoted: msg })
      if (randomHash) rememberAutoStickerHash(chat, randomHash, runtime.autoStickerRecentLimit)
      logger.info({
        trigger: stickerMatch.matched,
        triggerId: entry.id,
        type: 'sticker',
        combined,
        chat,
        bytes: sticker.length,
        randomLibrary: Boolean(randomLibrary),
        randomHash: randomHash || undefined,
        queueWaitMs,
        preparationMs: Date.now() - preparationStartedAt,
        executionMs: Date.now() - startedAt
      }, effectiveCombined ? 'figurinha do gatilho combinado enviada primeiro' : 'figurinha automática enviada')
      results.push('sticker')
    }

    const sendAudio = async () => {
      if (audioPrepared.status === 'rejected') {
        logger.warn({
          error: audioPrepared.reason,
          trigger: audioMatch?.matched,
          triggerId: audioMatch?.value?.id,
          file: audioMatch?.value?.relativeFile,
          chat,
          stage: 'trigger-prepare-audio',
          combined,
          queueWaitMs
        }, 'falha recuperável ao preparar áudio automático')
        return
      }
      if (!audioPrepared.value) return
      const { buffer, audio } = audioPrepared.value
      const startedAt = Date.now()
      await sock.sendMessage(chat, {
        audio: buffer,
        ptt: audio.ptt !== false,
        mimetype: audio.ptt !== false ? 'audio/ogg; codecs=opus' : 'audio/mpeg'
      }, effectiveCombined ? {} : { quoted: msg })
      logger.info({
        trigger: audioMatch.matched,
        triggerId: audio.id,
        type: 'audio',
        combined,
        chat,
        bytes: buffer.length,
        queueWaitMs,
        preparationMs: Date.now() - preparationStartedAt,
        executionMs: Date.now() - startedAt
      }, effectiveCombined ? 'áudio do gatilho combinado enviado depois da figurinha' : 'áudio automático enviado')
      results.push('audio')
    }

    // As duas mídias são preparadas em paralelo, mas o envio é determinístico:
    // figurinha primeiro e áudio depois. Isso evita o comportamento diferente
    // observado no gatilho "boa tarde" quando os uploads competiam entre si.
    for (const sender of [sendSticker, sendAudio]) {
      try { await sender() } catch (error) {
        logger.warn({ error, stage: 'trigger-dispatch', combined: effectiveCombined, chat, queueWaitMs }, 'falha recuperável ao enviar resposta automática')
      }
    }

    logger.debug({
      stage: 'trigger-dispatch-complete',
      audioId: audioMatch?.value?.id,
      stickerId: stickerMatch?.value?.id,
      sent: results,
      combined: effectiveCombined,
      dispatchMode,
      queueWaitMs,
      durationMs: Date.now() - preparationStartedAt,
      dispatcher: snapshot
    }, 'fila de resposta automática concluída')
    return results
  }, {
    audioId: audioMatch?.value?.id,
    stickerId: stickerMatch?.value?.id,
    combined: effectiveCombined,
    dispatchMode
  })

  queued.catch(error => {
    logger.warn({ error, stage: 'trigger-queue', chat, combined: effectiveCombined, dispatchMode }, 'resposta automática descartada pela fila de estabilidade')
  })
  return true
}

const metadataAdminCache = new WeakMap()

function metadataAdminDigits(metadata) {
  if (!metadata || typeof metadata !== 'object') return new Set()
  const cached = metadataAdminCache.get(metadata)
  if (cached) return cached
  const admins = new Set()
  for (const participant of metadata?.participants || []) {
    if (!participant?.admin) continue
    for (const id of [participant.id, participant.phoneNumber, participant.lid]) {
      const digits = jidDigits(id)
      if (digits) admins.add(digits)
    }
  }
  metadataAdminCache.set(metadata, admins)
  return admins
}

function participantIsAdmin(metadata, ...jids) {
  const admins = metadataAdminDigits(metadata)
  return jids.flat().some(jid => {
    const target = jidDigits(jid)
    return target && admins.has(target)
  })
}

async function getGroupPermissions(sock, msg, senderNumber, logger, { needMetadata = false, cachedOnly = false } = {}) {
  const startedAt = Date.now()
  const jid = msg.key.remoteJid || ''
  if (!jid.endsWith('@g.us')) return { isGroup: false, senderIsAdmin: false, botIsAdmin: false, metadata: null, permissionMs: Date.now() - startedAt, metadataSource: 'private-chat', metadataCacheHit: false }
  if (!needMetadata) {
    return { isGroup: true, senderIsAdmin: false, botIsAdmin: false, metadata: null, permissionMs: Date.now() - startedAt, metadataSource: 'not-needed', metadataCacheHit: false }
  }
  try {
    let detail
    if (cachedOnly && typeof sock.sakuraPeekGroupMetadata === 'function') {
      detail = sock.sakuraPeekGroupMetadata(jid)
      if (!detail) {
        const permissionMs = Date.now() - startedAt
        logger.debug({ chat: jid, stage: 'permissions', permissionMs, metadataSource: 'cache-empty', cachedOnly: true }, 'metadados não consultados para manter o caminho rápido')
        return { isGroup: true, senderIsAdmin: false, botIsAdmin: false, metadata: null, permissionMs, metadataSource: 'cache-empty', metadataCacheHit: false }
      }
    } else if (typeof sock.sakuraGetGroupMetadata === 'function') {
      detail = await sock.sakuraGetGroupMetadata(jid, { allowStale: true })
    } else {
      detail = { metadata: await sock.groupMetadata(jid), source: 'network', cacheHit: false, ageMs: 0, stale: false }
    }

    const metadata = detail?.metadata || null
    const senderJid = msg.key.participant || msg.key.participantAlt || `${senderNumber}@s.whatsapp.net`
    const senderIsAdmin = participantIsAdmin(metadata, senderJid, msg.key.participantAlt, `${senderNumber}@s.whatsapp.net`)
    const botIsAdmin = participantIsAdmin(metadata, sock.user?.id, sock.user?.lid)
    const permissionMs = Date.now() - startedAt
    logger.debug({
      chat: jid,
      stage: 'permissions',
      permissionMs,
      isGroup: true,
      isAdmin: senderIsAdmin,
      botIsAdmin,
      count: metadata?.participants?.length || 0,
      metadataSource: detail?.source || 'unknown',
      metadataCacheHit: Boolean(detail?.cacheHit),
      cacheAgeMs: detail?.ageMs,
      stale: Boolean(detail?.stale),
      cachedOnly
    }, 'permissões do grupo resolvidas')
    return { isGroup: true, senderIsAdmin, botIsAdmin, metadata, permissionMs, metadataSource: detail?.source || 'unknown', metadataCacheHit: Boolean(detail?.cacheHit), metadataAgeMs: detail?.ageMs || 0 }
  } catch (error) {
    const permissionMs = Date.now() - startedAt
    logger.debug({ error, chat: jid, stage: 'permissions', permissionMs, cachedOnly }, 'metadados do grupo indisponíveis')
    return { isGroup: true, senderIsAdmin: false, botIsAdmin: false, metadata: null, permissionMs, metadataSource: 'error', metadataCacheHit: false }
  }
}

async function playAdminDeniedAudio(sock, msg, logger) {
  const startedAt = Date.now()
  try {
    const file = path.join(settings.audioDir, 'legacy', 'tanana.mp3')
    const audio = await prepareLegacyAudio(file, logger)
    await sock.sendMessage(msg.key.remoteJid, {
      audio,
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus'
    }, { quoted: msg })
    logger.debug({ file, bytes: audio.length, executionMs: Date.now() - startedAt }, 'áudio de permissão negada enviado')
  } catch (error) {
    logger.debug({ error, executionMs: Date.now() - startedAt }, 'áudio tanana não enviado')
  }
}

export async function createMessageHandler(sock, logger) {
  const commands = await loadCommands(logger)
  const count = new Set([...commands.values()].map(command => command.name)).size
  logger.success({ count, aliases: commands.size }, 'comandos carregados')
  logger.success({ ...getTriggerStats(), stage: 'trigger-catalog' }, 'respostas automáticas carregadas')
  const scopedMessageLogger = typeof logger?.child === 'function'
    ? logger.child({ scope: 'MESSAGES' })
    : null
  const messageLogger = scopedMessageLogger && typeof scopedMessageLogger.info === 'function'
    ? scopedMessageLogger
    : logger
  void warmTriggerCaches(logger).catch(error => logger.debug({ error, stage: 'trigger-warmup' }, 'pré-cache de respostas automáticas não concluído'))

  return async function handleMessage(msg, upsertType = 'notify', queueMeta = {}) {
    const receivedAt = Date.now()
    const diagnostic = {
      messageId: msg?.key?.id,
      upsertType,
      chat: '',
      sender: '',
      type: 'unknown',
      stage: 'received',
      queueWaitMs: Number(queueMeta.queueWaitMs) || 0,
      batchIndex: Number(queueMeta.batchIndex) || 0,
      requestId: queueMeta.requestId || undefined
    }
    try {
      if (!msg?.message) {
        logger.debug({ ...diagnostic, stage: 'ignored-empty' }, 'mensagem sem conteúdo ignorada')
        return
      }
      if (upsertType !== 'notify') {
        logger.debug({ ...diagnostic, stage: 'ignored-history', reason: 'upsert-not-notify' }, 'mensagem antiga ou sincronizada ignorada')
        return
      }
      if (msg.key.fromMe) {
        const ownText = getMessageText(msg.message)
        if (!shouldProcessOwnMessage({ fromMe: true, text: ownText, prefix: settings.prefix })) {
          logger.debug({ ...diagnostic, stage: 'ignored-own' }, 'eco normal da própria Sakura ignorado')
          return
        }
      }
      if (!msg.key.remoteJid || msg.key.remoteJid === 'status@broadcast') {
        logger.debug({ ...diagnostic, stage: 'ignored-status' }, 'mensagem de status ou chat inválido ignorada')
        return
      }
      if (rememberMessageId(msg.key.id)) {
        logger.debug({ ...diagnostic, id: msg.key.id, stage: 'ignored-duplicate' }, 'mensagem duplicada ignorada')
        return
      }

      diagnostic.stage = 'identity-resolution'
      const identityStartedAt = Date.now()
      const numbers = await resolveMessageNumbers(sock, msg)
      const senderIsSelf = isConnectedSelf({
        sock,
        fromMe: Boolean(msg.key.fromMe),
        senderNumber: numbers.sender,
        botNumber: settings.botNumber
      })
      if (senderIsSelf) numbers.sender = connectedSelfNumber({ sock, botNumber: settings.botNumber, fallback: numbers.sender })
      diagnostic.chat = numbers.chat
      diagnostic.sender = numbers.sender
      const senderIsOwnerEarly = senderIsSelf || isConfiguredOwner(numbers.sender)
      const senderIsSubownerEarly = senderIsOwnerEarly ? false : isSubowner(numbers.sender)
      const senderJid = String(msg.key.participant || msg.key.participantAlt || msg.key.remoteJid || '')
      const senderAltJid = String(msg.key.participantAlt || msg.key.remoteJidAlt || '')
      const phoneJid = [senderAltJid, senderJid].find(value => /@(s\.whatsapp\.net|hosted)$/i.test(value)) || (numbers.sender ? `${numbers.sender}@s.whatsapp.net` : '')
      const lidJid = [senderJid, senderAltJid].find(value => /@(lid|hosted\.lid)$/i.test(value)) || ''
      const mentionJid = senderJid || lidJid || phoneJid
      try {
        rememberUser({
          number: numbers.sender,
          jid: mentionJid,
          mentionJid,
          phoneJid,
          lidJid,
          name: msg.pushName || '',
          source: 'message'
        })
      } catch (error) {
        logger.debug({ error, stage: 'user-directory' }, 'nome do usuário não foi armazenado')
      }
      const identityMs = Date.now() - identityStartedAt

      diagnostic.stage = 'decode'
      const decodeStartedAt = Date.now()
      const messageType = getMessageType(msg.message)
      diagnostic.type = messageType
      const selection = getSelectionDetails(msg.message)
      let text = getMessageText(msg.message)
      if (selection.selected) text = normalizeCommandText(selection.selected, settings.prefix)
      const parseMs = Date.now() - decodeStartedAt

      if (await enforcePrivateMessageProtection({
        sock, msg, senderNumber: numbers.sender,
        isOwner: senderIsOwnerEarly, isSubowner: senderIsSubownerEarly, logger
      })) {
        logger.debug({ ...diagnostic, stage: 'anti-pv-complete' }, 'mensagem privada encerrada pelo Anti-PV')
        return
      }

      const commandParseStartedAt = Date.now()
      const isCommandCandidate = Boolean(text && text.startsWith(settings.prefix))
      const rawBody = isCommandCandidate ? text.slice(settings.prefix.length).trim() : ''
      const body = rawBody.replace(/^[.!/#]+(?=\S)/, '')
      const commandMatch = body ? body.match(/^(\S+)(?:\s+([\s\S]*))?$/) : null
      const requestedCommandName = commandMatch?.[1] || ''
      let commandName = requestedCommandName
      const rawArgs = commandMatch?.[2] || ''
      const args = rawArgs.trim() ? rawArgs.trim().split(/\s+/) : []
      let command = commandName ? (commands.get(commandName.toLowerCase()) || commands.get(normalizeCommandKey(commandName))) : null
      let commandCorrection = null
      if (!command && commandName) {
        commandCorrection = resolveCommandCorrection(commandName, commands)
        if (commandCorrection?.autoExecute) {
          command = commandCorrection.command
          commandName = commandCorrection.matchedName || command.name
          logger.info({ requested: requestedCommandName, corrected: commandName, command: command.name, distance: commandCorrection.distance, confidence: commandCorrection.confidence }, 'comando corrigido automaticamente com alta confiança')
        }
      }
      const canonicalAction = canonicalShortTarget(commandName) || commandName
      const effectiveText = isCommandCandidate
        ? `${settings.prefix}${canonicalAction}${rawArgs ? ` ${rawArgs}` : ''}`
        : text
      const commandParseMs = Date.now() - commandParseStartedAt
      const isMenuSelection = Boolean(selection.selected)
      const sensitiveArgs = Boolean(command?.sensitiveArgs)
      const safeTextPreview = sensitiveArgs ? '[conteúdo protegido]' : text.slice(0, 160)
      const safeArgsPreview = sensitiveArgs ? '[conteúdo protegido]' : rawArgs.slice(0, 120)
      diagnostic.command = command?.name || commandName || undefined

      const incomingLog = (isCommandCandidate || settings.showReceivedMessages) ? messageLogger.info.bind(messageLogger) : messageLogger.debug.bind(messageLogger)
      incomingLog({
        senderName: String(msg.pushName || 'Sem nome').trim().slice(0, 80),
        senderNumber: numbers.sender || 'desconhecido',
        senderJid: mentionJid || 'desconhecido',
        phoneJid: phoneJid || undefined,
        lidJid: lidJid || undefined,
        chatJid: msg.key.remoteJid,
        isGroup: msg.key.remoteJid.endsWith('@g.us'),
        messageType,
        command: command?.name || commandName || undefined,
        textPreview: safeTextPreview || `[${messageType}]`
      }, isCommandCandidate ? 'comando recebido' : 'mensagem recebida')

      logger.debug({
        id: msg.key.id,
        messageId: msg.key.id,
        type: messageType,
        upsertType,
        chat: numbers.chat,
        sender: numbers.sender,
        selection: selection.selected || undefined,
        selectionSource: selection.source || undefined,
        wrappers: selection.wrappers,
        rawParams: selection.rawParams || undefined,
        textPreview: safeTextPreview,
        parseMs,
        identityMs,
        isGroup: msg.key.remoteJid.endsWith('@g.us'),
        commandCandidate: isCommandCandidate,
        command: command?.name || commandName || undefined,
        commandParseMs,
        queueWaitMs: diagnostic.queueWaitMs,
        requestId: diagnostic.requestId
      }, 'mensagem recebida e decodificada')

      const isGroupChat = msg.key.remoteJid.endsWith('@g.us')
      if (isGroupChat) {
        diagnostic.stage = 'contract-check'
        const senderCanBypassContract = senderIsOwnerEarly || senderIsSubownerEarly
        const contractActive = await hasActiveRental(msg.key.remoteJid)
        if (!contractActive && !senderCanBypassContract) {
          logger.debug({ chat: numbers.chat, sender: numbers.sender, stage: 'contract-silent-block', command: command?.name || commandName || undefined }, 'grupo sem contrato ativo; mensagem ignorada silenciosamente')
          return
        }
        if (!contractActive && senderCanBypassContract) {
          logger.debug({ chat: numbers.chat, sender: numbers.sender, stage: 'contract-owner-bypass', command: command?.name || commandName || undefined }, 'dono/subdono executou comando em grupo sem contrato para manutenção')
        }
      }

      diagnostic.stage = 'anti-link'
      if (await maybeEnforceAntiLink({
        sock, msg, text, senderNumber: numbers.sender, ownerNumber: settings.ownerNumber, logger
      })) {
        logger.debug({ ...diagnostic, stage: 'antilink-complete', durationMs: Date.now() - receivedAt }, 'mensagem encerrada pelo AntiLink')
        return
      }

      diagnostic.stage = 'afk-presence'
      await handleAfkPresence(sock, msg, numbers, text, logger, {
        skipReferences: Boolean(command?.skipAfkReferences || command?.fastPath)
      })

      if (rememberRecentStickerMedia(msg, numbers.chat, numbers.sender)) {
        logger.debug({ chat: numbers.chat, sender: numbers.sender, messageId: msg.key.id, stage: 'sticker-batch-cache' }, 'mídia recente registrada para lote de figurinhas')
      }

      if (!text) {
        logger.debug({ ...diagnostic, stage: 'ignored-no-text', durationMs: Date.now() - receivedAt }, 'mensagem sem texto processável concluída')
        return
      }

      diagnostic.stage = 'activity'
      void recordActivity(numbers.sender, numbers.chat).catch(error => logger.debug({ error, chat: numbers.chat, sender: numbers.sender }, 'atividade não registrada'))

      if (!isCommandCandidate) {
        const normalizedText = normalizeTriggerText(text)
        diagnostic.stage = 'triggers'
        const timestamp = messageTimestampMs(msg)
        const messageAgeMs = timestamp ? Math.max(0, Date.now() - timestamp) : 0
        const freshForAutomation = !timestamp || messageAgeMs <= settings.autoTriggerMaxAgeMs
        if (!freshForAutomation) {
          logger.debug({ ...diagnostic, stage: 'trigger-skipped-old', messageAgeMs, maxAgeMs: settings.autoTriggerMaxAgeMs }, 'resposta automática ignorou mensagem atrasada')
        } else {
          const autoDownload = maybeQueueAutoDownload({ sock, msg, text, senderNumber: numbers.sender, logger })
          if (autoDownload.queued) {
            logger.debug({ ...diagnostic, stage: 'auto-download-queued', queued: autoDownload.queued, pending: autoDownload.pending }, 'AutoDownload genérico colocado na fila')
            return
          }
          const autoTikTok = maybeQueueAutoTikTok({ sock, msg, text, senderNumber: numbers.sender, logger })
          if (autoTikTok.queued) {
            logger.debug({ ...diagnostic, stage: 'tiktok-auto-queued', queued: autoTikTok.queued, pending: autoTikTok.pending }, 'TikTok automático colocado na fila')
            return
          }
          const autoSocial = maybeQueueAutoSocial({ sock, msg, text, senderNumber: numbers.sender, logger })
          if (autoSocial.queued) {
            logger.debug({ ...diagnostic, stage: 'social-auto-queued', queued: autoSocial.queued, pending: autoSocial.pending }, 'Instagram/Pinterest automático colocado na fila')
            return
          }
          if (!selection.selected && await runTriggers(sock, msg, normalizedText, logger, {
            isGroup: msg.key.remoteJid.endsWith('@g.us'),
            mentionedBot: messageMentionsBot(sock, msg),
            messageAgeMs,
            chat: numbers.chat,
            sender: numbers.sender,
            userName: msg.pushName || 'Usuário'
          })) {
            logger.debug({ ...diagnostic, stage: 'trigger-complete', durationMs: Date.now() - receivedAt }, 'processamento encerrado por resposta automática')
            return
          }
        }
        diagnostic.stage = 'ai'
        void maybeHandleAi({
          sock, msg, text, numbers, logger,
          isGroup: msg.key.remoteJid.endsWith('@g.us'),
          mentionedBot: messageMentionsBot(sock, msg),
          commands,
          notifyFailure: messageCallsSakura(text)
        }).catch(error => logger.warn({ error, stage: 'ai-dispatch', chat: numbers.chat, sender: numbers.sender }, 'falha recuperável ao despachar IA'))
        logger.debug({ ...diagnostic, stage: 'non-command', durationMs: Date.now() - receivedAt }, 'mensagem comum concluída')
        return
      }

      diagnostic.stage = 'command-parse'
      if (!body) return

      logger.debug({
        command: command?.name || commandName,
        alias: command && commandName.toLowerCase() !== command.name.toLowerCase() ? commandName : undefined,
        argsCount: args.length,
        rawArgLength: rawArgs.length,
        textPreview: safeArgsPreview,
        parseMs: commandParseMs,
        chat: numbers.chat,
        sender: numbers.sender
      }, 'comando analisado')

      diagnostic.stage = 'permissions'
      const permissionNeedsMetadata = Boolean(command?.adminOnly || command?.strictAdminOnly || command?.botAdminOnly || command?.needsMetadata)
      const permissions = await getGroupPermissions(sock, msg, numbers.sender, logger, {
        needMetadata: permissionNeedsMetadata,
        cachedOnly: false
      })

      if (isMenuSelection) {
        logger.info({ selection: body, selectionSource: selection.source, sender: numbers.sender, chat: numbers.chat }, 'opção selecionada no menu')
      }

      const senderIsOwner = senderIsOwnerEarly
      const senderIsSubowner = senderIsSubownerEarly
      const role = senderIsOwner ? 'owner' : senderIsSubowner ? 'subowner' : permissions.senderIsAdmin ? 'admin' : 'member'

      const receptionAction = normalizeCommandKey(canonicalAction || commandName)
      const receptionBypass = command?.name === 'recepcao' || ['recepcao', 'recepção', 'ficha', 'minhaficha'].includes(receptionAction)
      if (permissions.isGroup && !senderIsOwner && !senderIsSubowner && !receptionBypass) {
        const receptionGate = await getReceptionGate(msg.key.remoteJid, numbers.sender)
        if (receptionGate.pending) {
          const model = buildReceptionModel(receptionGate.config, settings.prefix)
          logger.info({ sender: numbers.sender, chat: numbers.chat, command: requestedCommandName || commandName, action: 'reception-gate' }, 'comando bloqueado até concluir a recepção')
          await reply(sock, msg, [
            'Sua ficha de recepção ainda está pendente.',
            'Preencha o modelo corretamente para liberar os comandos.'
          ].join('\n'), {
            title: 'RECEPÇÃO PENDENTE',
            nativeFlow: [{ text: '🌸 Copiar modelo', copy: model }]
          })
          return
        }
      }

      if (!command) {
        logger.warn({ command: requestedCommandName || commandName, selection: selection.selected || undefined, sender: numbers.sender, chat: numbers.chat, argsCount: args.length, correction: commandCorrection?.command?.name, correctionConfidence: commandCorrection?.confidence }, 'comando não encontrado')
        const base = buildCommandNotFound(requestedCommandName || commandName, commands, { role })
        const correctionHint = commandCorrection?.command
          ? `\n💮 Correção provável: *${settings.prefix}${commandCorrection.command.name}* — digite exatamente assim para confirmar.`
          : ''
        await reply(sock, msg, `${base}${correctionHint}`, { title: 'COMANDO INVÁLIDO' })
        return
      }

      const senderVip = senderIsOwner || senderIsSubowner || await isVip(numbers.sender)
      const effectiveAdmin = permissions.senderIsAdmin || senderIsOwner || senderIsSubowner
      if (command.vipOnly && !senderVip) {
        logger.info({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'vip-denied' }, 'comando VIP negado para conta gratuita')
        await reply(sock, msg, `Este comando é exclusivo do Sakura VIP.
Usuários gratuitos continuam com acesso aos comandos essenciais e limites padrão.`, { title: 'SAKURA VIP' })
        return
      }
      if (command.privateOnly && permissions.isGroup) {
        await reply(sock, msg, 'Este comando é exclusivo do privado.', { title: 'COMANDO PRIVADO' })
        return
      }
      if (command.groupOnly && !permissions.isGroup) {
        logger.debug({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'group-only-denied' }, 'comando recusado fora de grupo')
        await reply(sock, msg, '💮 comando exclusivo de grupo')
        return
      }
      if (command.strictAdminOnly && !permissions.senderIsAdmin) {
        logger.info({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'strict-admin-denied' }, 'comando restrito a administrador real do grupo')
        await playAdminDeniedAudio(sock, msg, logger)
        return
      }
      if (command.adminOnly && !permissions.senderIsAdmin && !senderIsOwner && !senderIsSubowner) {
        logger.info({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'admin-denied' }, 'comando de administrador negado')
        await playAdminDeniedAudio(sock, msg, logger)
        return
      }
      if (command.botAdminOnly && !permissions.botIsAdmin) {
        logger.debug({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'bot-admin-denied' }, 'comando recusado porque a Sakura não é administradora')
        await reply(sock, msg, '💮 preciso ser administradora do grupo')
        return
      }
      if (command.ownerOnly && !senderIsOwner && !(command.subownerAllowed && senderIsSubowner)) {
        logger.info({ command: command.name, sender: numbers.sender, chat: numbers.chat, action: 'owner-denied' }, 'comando de dono negado')
        await playAdminDeniedAudio(sock, msg, logger)
        return
      }

      if (permissions.isGroup && !(command.name === 'automacoes' && effectiveAdmin)) {
        diagnostic.stage = 'antiflood'
        const flood = checkCommandFlood({
          chat: msg.key.remoteJid,
          user: numbers.sender,
          role,
          cost: senderVip ? Math.max(1, Math.ceil(commandFloodCost(command) / Math.max(1, Number(settings.vipPriorityMultiplier || 2)))) : commandFloodCost(command)
        })
        if (!flood.allowed) {
          logger.info({ command: command.name, sender: numbers.sender, chat: numbers.chat, reason: flood.reason, blocked: flood.blocked, remainingMs: flood.remainingMs }, 'comando interrompido pelo antiflood')
          if (flood.warning) {
            const text = flood.blocked
              ? `🌸 Muitos comandos em sequência. Bloqueio temporário por ${compactDuration(flood.remainingMs)}.`
              : `🌸 Você atingiu o limite de comandos. Diminua o ritmo para evitar bloqueio temporário.`
            await reply(sock, msg, text, { title: 'ANTIFLOOD' })
          }
          return
        }
      }

      diagnostic.stage = 'command-record'
      void recordCommand(numbers.sender, numbers.chat).catch(error => logger.debug({ error, command: command.name, chat: numbers.chat, sender: numbers.sender }, 'comando não registrado na economia'))

      diagnostic.stage = 'command-execute'
      const executionStartedAt = Date.now()
      logger.info({
        command: command.name,
        alias: commandName.toLowerCase() !== command.name.toLowerCase() ? commandName : undefined,
        sender: numbers.sender,
        senderName: String(msg.pushName || 'Sem nome').trim().slice(0, 80),
        senderNumber: numbers.sender,
        senderJid: mentionJid,
        chat: numbers.chat,
        chatJid: msg.key.remoteJid,
        argsCount: args.length,
        rawArgLength: rawArgs.length,
        isGroup: permissions.isGroup,
        isAdmin: effectiveAdmin,
        botIsAdmin: permissions.botIsAdmin,
        vip: senderVip,
        priority: senderVip ? 'vip' : command.priority,
        permissionMs: permissions.permissionMs,
        metadataSource: permissions.metadataSource,
        metadataCacheHit: permissions.metadataCacheHit,
        queueWaitMs: diagnostic.queueWaitMs
      }, 'executando comando')

      try {
        setCommandOfficialLinks(msg, command.officialLinks === true)
        await reactToCommand(sock, msg, command, 'start')
        const commandContext = workstationContext({
          sock, msg, args, rawArgs, text: effectiveText, commands, settings,
          invokedAs: canonicalAction,
          rawInvokedAs: commandName,
          canonicalAction,
          startedAt: receivedAt,
          logger,
          senderNumber: numbers.sender,
          chatNumber: numbers.chat,
          selection,
          isGroup: permissions.isGroup,
          isAdmin: effectiveAdmin,
          isBotAdmin: permissions.botIsAdmin,
          isOwner: senderIsOwner,
          isSubowner: senderIsSubowner,
          isVip: senderVip,
          priority: senderVip ? 'vip' : command.priority,
          role,
          metadata: permissions.metadata,
          metadataSource: permissions.metadataSource,
          metadataCacheHit: permissions.metadataCacheHit,
          metadataAgeMs: permissions.metadataAgeMs
        })
        await withSendPriority(senderVip ? 'vip' : command.priority, () => command.execute(commandContext))
        clearCommandOfficialLinks(msg)
        await reactToCommand(sock, msg, command, 'success')
      } catch (error) {
        clearCommandOfficialLinks(msg)
        await reactToCommand(sock, msg, command, 'error')
        logger.error({
          error,
          command: command.name,
          alias: commandName.toLowerCase() !== command.name.toLowerCase() ? commandName : undefined,
          executionMs: Date.now() - executionStartedAt,
          durationMs: Date.now() - receivedAt,
          argsCount: args.length,
          rawArgLength: rawArgs.length,
          textPreview: safeArgsPreview,
          sender: numbers.sender,
          chat: numbers.chat,
          isGroup: permissions.isGroup,
          isAdmin: effectiveAdmin,
          botIsAdmin: permissions.botIsAdmin
        }, 'falha detalhada na execução do comando')
        throw error
      }

      logger.success({
        command: command.name,
        executionMs: Date.now() - executionStartedAt,
        durationMs: Date.now() - receivedAt,
        sender: numbers.sender,
        senderName: String(msg.pushName || 'Sem nome').trim().slice(0, 80),
        senderNumber: numbers.sender,
        senderJid: mentionJid,
        chat: numbers.chat,
        chatJid: msg.key.remoteJid,
        argsCount: args.length,
        queueWaitMs: diagnostic.queueWaitMs,
        metadataSource: permissions.metadataSource,
        metadataCacheHit: permissions.metadataCacheHit
      }, 'comando concluído')
    } catch (error) {
      logger.error({ error, ...diagnostic, durationMs: Date.now() - receivedAt }, 'erro no processamento da mensagem')
      try { await reply(sock, msg, '💮 ocorreu um erro interno ao executar essa ação.') } catch {}
    }
  }
}
