import fs from 'node:fs/promises'
import { createSakuraCopyCard } from '@sakura-md/baileys'
import { downloadTikTok, isTikTokUrl } from './tiktok.js'
import { downloadSocialMedia, isSocialMediaUrl, socialPlatform } from './social-downloader.js'
import { enqueueMediaTask } from './media-priority.js'
import { getVipBenefits } from './vip.js'
import { settings } from './settings.js'
import { prepareLegacyAudio } from './legacy-audio.js'
import { resolveDailyAudio } from './automation-media.js'
import { hasActiveRental } from './rentals.js'
import { resolveMentionIdentities } from './mentions.js'
import {
  claimDailyRun,
  getAutomationConfig,
  isQuietHoursActive,
  listDailyAutomationGroups,
  reserveTikTokUrl,
  reserveSocialUrl
} from './automation-store.js'
import { claimGroupSchedule, listAllGroupSchedules } from './group-schedule-store.js'
import { enqueueBulkSend } from './bulk-send-queue.js'
import { claimGlobalMorning, getGlobalMorningConfig, isGlobalMorningDisabledForGroup, releaseGlobalMorningClaim } from './global-morning-store.js'
import { buildReceptionModel, getReceptionConfig, getReceptionProfile, formatReceptionCard, markReceptionPending } from './reception.js'
import { formatMessage } from './formatter.js'

const welcomeBatches = new Map()
const tiktokQueues = new Map()
const socialQueues = new Map()
let dailyTimer = null
let dailyRunning = false
let scheduleRunning = false
let globalMorningRunning = false

const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const mentionText = identity => `@${identity?.number || digits(identity?.phoneJid || identity?.mentionJid || identity) || 'membro'}`

export function normalizeReceptionParticipant(participant) {
  const raw = participant && typeof participant === 'object' ? participant : { id: participant }
  const candidates = [raw.phoneNumber, raw.pn, raw.phoneJid, raw.id, raw.jid, raw.lid, participant]
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
  const phoneJid = candidates.find(value => value.endsWith('@s.whatsapp.net')) || ''
  const mentionJid = phoneJid || candidates.find(value => value.includes('@')) || ''
  const number = digits(phoneJid || mentionJid)
  return { number, jid: mentionJid, phoneJid, raw }
}

function uniqueJids(values = []) {
  return [...new Set(values.flatMap(value => {
    if (typeof value === 'string') return value.includes('@') ? [value] : []
    const identity = normalizeReceptionParticipant(value)
    return identity.jid ? [identity.jid] : []
  }))]
}

async function groupParticipants(sock, chat) {
  const metadata = await sock.groupMetadata(chat)
  const botNumbers = new Set([sock?.user?.id, sock?.user?.lid].map(digits).filter(Boolean))
  return uniqueJids((metadata?.participants || []).map(row => row?.id || row?.jid).filter(jid => jid && !botNumbers.has(digits(jid))))
}

async function groupPicture(sock, chat) {
  try { return await sock.profilePictureUrl(chat, 'image') } catch { return '' }
}

function receptionEntryText(number = '', config = {}) {
  const mention = number ? `@${number}` : 'novo membro'
  const fields = Array.isArray(config?.fields) && config.fields.length ? config.fields : ['nome', 'idade', 'cidade']
  const labels = { nome: 'Nome', idade: 'Idade', cidade: 'Cidade' }
  const blankFields = fields.map(field => `${labels[field] || String(field).replace(/^./, c => c.toUpperCase())}:`).join('\n')
  return [
    '🌸 *RECEPÇÃO*',
    '',
    `Bem-vindo(a), ${mention}!`,
    'Antes de usar os comandos da Sakura,',
    'preencha sua ficha corretamente.',
    '',
    blankFields,
    '',
    '🌸 Toque no botão para copiar o modelo,',
    'preencha e envie aqui no grupo.',
    '',
    'Depois da ficha aprovada, os comandos',
    'serão liberados automaticamente.'
  ].join('\n')
}

async function sendReceptionEntry(sock, chat, participant, logger) {
  const config = await getReceptionConfig(chat)
  if (!config.enabled) return false
  const identity = normalizeReceptionParticipant(participant)
  const number = identity.number
  const botNumbers = new Set([sock?.user?.id, sock?.user?.lid].map(digits).filter(Boolean))
  if (!number || botNumbers.has(number)) return false

  await markReceptionPending(chat, number, { source: 'group-add' })
  const model = buildReceptionModel(config, settings.prefix)
  const content = createSakuraCopyCard({
    body: receptionEntryText(number, config),
    footer: 'Preencha a ficha para liberar os comandos',
    buttonText: '🌸 Copiar modelo',
    copyText: model
  })
  try {
    await sock.sendMessage(chat, content)
    logger?.info?.({ chatJid: chat, participant: number, action: 'reception-pending' }, 'recepção enviada para novo membro')
    return true
  } catch (error) {
    logger?.warn?.({ error, chatJid: chat, participant: number }, 'falha recuperável ao enviar recepção')
    return false
  }
}

async function flushWelcome(chat, sock, logger) {
  const batch = welcomeBatches.get(chat)
  if (!batch) return
  welcomeBatches.delete(chat)
  clearTimeout(batch.timer)
  const config = getAutomationConfig(chat)
  if (!config.welcomeEnabled || isQuietHoursActive(config) || !(await hasActiveRental(chat))) return
  const candidates = uniqueJids([...batch.participants])
  if (!candidates.length) return
  const identities = (await resolveMentionIdentities(sock, chat, candidates)).filter(item => item.mentionJid)
  if (!identities.length) return
  const names = identities.map(mentionText).join(', ')
  const mentions = [...new Set(identities.map(item => item.mentionJid))]
  const caption = [
    identities.length === 1 ? `🌸 Bem-vindo(a), ${names}!` : `🌸 Sejam bem-vindos, ${names}!`,
    config.welcomeMessage
  ].filter(Boolean).join('\n\n')
  try {
    const picture = await groupPicture(sock, chat)
    if (picture) await sock.sendMessage(chat, { image: { url: picture }, caption, mentions })
    else await sock.sendMessage(chat, { text: caption, mentions })
    logger?.info?.({ chatJid: chat, participants: identities.length, mentions: mentions.length }, 'boas-vindas agrupadas enviadas')
  } catch (error) {
    logger?.warn?.({ error, chatJid: chat, participants: identities.length }, 'falha recuperável ao enviar boas-vindas agrupadas')
  }
}

export function handleGroupParticipantsUpdate(sock, payload, logger) {
  const chat = String(payload?.id || '')
  if (!chat.endsWith('@g.us') || payload?.action !== 'add') return false
  const rawParticipants = Array.isArray(payload?.participants) ? payload.participants : []
  const receptionParticipants = rawParticipants
    .map(normalizeReceptionParticipant)
    .filter(identity => identity.number && identity.jid)
  if (!receptionParticipants.length) return false

  // O fork atual do Baileys emite GroupParticipant (objeto com id/lid/phoneNumber),
  // não apenas strings. A recepção usa o PN quando disponível para que a catraca
  // reconheça o mesmo número visto depois pelo handler de mensagens.
  for (const identity of receptionParticipants) {
    void sendReceptionEntry(sock, chat, identity.raw, logger).catch(error => {
      logger?.warn?.({ error, chatJid: chat, participant: identity.number }, 'falha ao processar recepção de entrada')
    })
  }

  const participants = [...new Set(receptionParticipants.map(identity => identity.jid))]
  const config = getAutomationConfig(chat)
  if (!config.welcomeEnabled) return true
  const existing = welcomeBatches.get(chat) || { participants: new Set(), timer: null }
  for (const jid of participants) existing.participants.add(jid)
  if (existing.timer) clearTimeout(existing.timer)
  existing.timer = setTimeout(() => void flushWelcome(chat, sock, logger), settings.welcomeBatchMs)
  existing.timer.unref?.()
  welcomeBatches.set(chat, existing)
  return true
}

function extractTikTokUrls(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>()]+/gi) || []
  return [...new Set(matches.map(value => value.replace(/[),.;!?]+$/, '')).filter(isTikTokUrl))].slice(0, 2)
}

function queueFor(chat) {
  if (!tiktokQueues.has(chat)) tiktokQueues.set(chat, { running: false, jobs: [] })
  return tiktokQueues.get(chat)
}

function pumpTikTok(chat, logger) {
  const queue = queueFor(chat)
  if (queue.running) return
  const job = queue.jobs.shift()
  if (!job) {
    tiktokQueues.delete(chat)
    return
  }
  queue.running = true
  void runTikTokJob(job, logger).finally(() => {
    queue.running = false
    pumpTikTok(chat, logger)
  })
}

async function runTikTokJob({ sock, msg, url, senderNumber }, logger) {
  const vipState = await getVipBenefits(senderNumber)
  const vip = vipState.active
  const maxMb = vipState.mediaLimitMb
  let result
  try {
    result = await enqueueMediaTask(() => downloadTikTok(url, { maxBytes: maxMb * 1024 * 1024 }), { vip })
    await sock.sendMessage(msg.key.remoteJid, {
      video: { url: result.filePath },
      mimetype: 'video/mp4',
      caption: formatMessage(`título: ${result.title}\nautor: ${result.author}\nmodo: TikTok automático\nplano: ${vipState.planName}\nlimite: ${maxMb} MB`, { title: 'TIKTOK AUTO' })
    }, { quoted: msg })
  } catch (error) {
    logger?.warn?.({ error, chat: msg.key.remoteJid, url }, 'falha no TikTok automático')
    const text = error?.code === 'TIKTOK_TOO_LARGE'
      ? `💮 O vídeo do TikTok ultrapassa o limite de ${maxMb} MB.`
      : '💮 Não consegui baixar esse link do TikTok agora.'
    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg }).catch(() => {})
  } finally {
    if (result?.cleanup) await Promise.all(result.cleanup.map(file => fs.rm(file, { force: true }).catch(() => {})))
  }
}

export function maybeQueueAutoTikTok({ sock, msg, text, senderNumber, logger } = {}) {
  const chat = String(msg?.key?.remoteJid || '')
  if (!chat.endsWith('@g.us')) return { queued: 0 }
  const config = getAutomationConfig(chat)
  if (!config.tiktokAutoEnabled || isQuietHoursActive(config)) return { queued: 0 }
  const urls = extractTikTokUrls(text)
  if (!urls.length) return { queued: 0 }
  const queue = queueFor(chat)
  let queued = 0
  for (const url of urls) {
    if (queue.jobs.length >= settings.tiktokAutoQueuePerChat) break
    if (!reserveTikTokUrl(chat, url)) continue
    queue.jobs.push({ sock, msg, url, senderNumber })
    queued += 1
  }
  if (queued) pumpTikTok(chat, logger)
  return { queued, pending: queue.jobs.length, running: queue.running }
}


function extractSocialUrls(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>()]+/gi) || []
  return [...new Set(matches.map(value => value.replace(/[),.;!?]+$/, '')).filter(isSocialMediaUrl))].slice(0, 2)
}

function socialQueueFor(chat) {
  if (!socialQueues.has(chat)) socialQueues.set(chat, { running: false, jobs: [] })
  return socialQueues.get(chat)
}

function pumpSocial(chat, logger) {
  const queue = socialQueueFor(chat)
  if (queue.running) return
  const job = queue.jobs.shift()
  if (!job) {
    socialQueues.delete(chat)
    return
  }
  queue.running = true
  void runSocialJob(job, logger).finally(() => {
    queue.running = false
    pumpSocial(chat, logger)
  })
}

async function runSocialJob({ sock, msg, url, senderNumber }, logger) {
  const vipState = await getVipBenefits(senderNumber)
  const vip = vipState.active
  const maxMb = vipState.mediaLimitMb
  const platform = socialPlatform(url)
  let result
  try {
    result = await enqueueMediaTask(() => downloadSocialMedia(url, { maxBytes: maxMb * 1024 * 1024 }), { vip })
    const caption = formatMessage(`título: ${result.title}
autor: ${result.author || platform}
modo: ${platform} automático
plano: ${vipState.planName}
limite: ${maxMb} MB`, { title: 'DOWNLOAD AUTO' })
    const safeMime = result.kind === 'image'
      ? (String(result.mimetype || '').startsWith('image/') ? result.mimetype : 'image/jpeg')
      : (String(result.mimetype || '').startsWith('video/') ? result.mimetype : 'video/mp4')
    const content = result.kind === 'image'
      ? { image: { url: result.filePath }, mimetype: safeMime, caption }
      : { video: { url: result.filePath }, mimetype: safeMime, caption }
    await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg })
  } catch (error) {
    logger?.warn?.({ error, chat: msg.key.remoteJid, url, platform }, 'falha no download social automático')
    const text = error?.code === 'SOCIAL_TOO_LARGE'
      ? `💮 A mídia do ${platform} ultrapassa o limite de ${maxMb} MB.`
      : `💮 Não consegui baixar esse link do ${platform} agora.`
    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg }).catch(() => {})
  } finally {
    if (result?.cleanup) await Promise.all(result.cleanup.map(file => fs.rm(file, { recursive: true, force: true }).catch(() => {})))
  }
}

export function maybeQueueAutoSocial({ sock, msg, text, senderNumber, logger } = {}) {
  const chat = String(msg?.key?.remoteJid || '')
  if (!chat.endsWith('@g.us')) return { queued: 0 }
  const config = getAutomationConfig(chat)
  if (!config.socialAutoEnabled || isQuietHoursActive(config)) return { queued: 0 }
  const urls = extractSocialUrls(text)
  if (!urls.length) return { queued: 0 }
  const queue = socialQueueFor(chat)
  let queued = 0
  for (const url of urls) {
    if (queue.jobs.length >= settings.socialAutoQueuePerChat) break
    const platform = socialPlatform(url)
    if (!reserveSocialUrl(chat, platform, url)) continue
    queue.jobs.push({ sock, msg, url, senderNumber })
    queued += 1
  }
  if (queued) pumpSocial(chat, logger)
  return { queued, pending: queue.jobs.length, running: queue.running }
}

function localClock(timeZone, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function timeReached(current, target) {
  return Number(current.replace(':', '')) >= Number(target.replace(':', ''))
}

async function sendMentionChunks(sock, chat, participants, message, { bulk = false, runKey = '' } = {}) {
  const identities = (await resolveMentionIdentities(sock, chat, participants)).filter(item => item.mentionJid)
  const chunkSize = 80
  for (let index = 0; index < identities.length; index += chunkSize) {
    const chunk = identities.slice(index, index + chunkSize)
    const header = index === 0 ? message : '🌸 Continuação das marcações:'
    const text = `${header}\n\n${chunk.map(mentionText).join(' ')}`
    const send = () => sock.sendMessage(chat, { text, mentions: chunk.map(item => item.mentionJid) })
    if (bulk) await enqueueBulkSend(send, { key: `${runKey}:${chat}:mentions:${index}`, chat })
    else await send()
  }
}

async function participatingGroupIds(sock) {
  const result = await sock.groupFetchAllParticipating?.()
  if (result instanceof Map) return [...result.keys()].filter(chat => String(chat).endsWith('@g.us'))
  return Object.keys(result || {}).filter(chat => String(chat).endsWith('@g.us'))
}

function chooseMorningMessage(config, chat, localDate) {
  const messages = Array.isArray(config.messages) && config.messages.length ? config.messages : ['Bom dia! 🌸']
  let hash = 0
  for (const char of `${chat}:${localDate}`) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return messages[hash % messages.length]
}

async function sendGlobalMorningToGroup(sock, chat, config, localDate, audioBuffer, logger, { force = false } = {}) {
  if (!force && isGlobalMorningDisabledForGroup(chat)) return { skipped: true, reason: 'group-disabled' }
  if (!force && !(await hasActiveRental(chat))) return { skipped: true, reason: 'inactive-contract' }
  const localConfig = getAutomationConfig(chat)
  if (!force && isQuietHoursActive(localConfig)) return { skipped: true, reason: 'quiet-hours' }
  if (!force && localConfig.dailyEnabled) return { skipped: true, reason: 'local-routine-priority' }
  const metadata = await sock.groupMetadata(chat)
  const botNumbers = new Set([sock?.user?.id, sock?.user?.lid].map(digits).filter(Boolean))
  const participants = uniqueJids((metadata?.participants || []).map(row => row?.id || row?.jid).filter(jid => jid && !botNumbers.has(digits(jid))))
  if (!participants.length) return { skipped: true, reason: 'empty-group' }
  const subject = String(metadata?.subject || 'grupo').trim().slice(0, 100)
  const message = `💮 *Bom dia, ${subject}!*\n\n${chooseMorningMessage(config, chat, localDate)}`
  const runKey = `global-morning:${localDate}`
  await sendMentionChunks(sock, chat, participants, message, { bulk: true, runKey })
  if (audioBuffer) {
    await enqueueBulkSend(
      () => sock.sendMessage(chat, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }),
      { key: `${runKey}:${chat}:audio`, chat }
    )
  }
  logger?.info?.({ chat, subject, participants: participants.length, date: localDate }, 'bom dia global enviado com fila segura')
  return { sent: true, participants: participants.length }
}

export async function runGlobalMorningSweep(sock, logger, now = new Date()) {
  if (globalMorningRunning || !sock) return { ran: false, reason: 'busy' }
  const config = getGlobalMorningConfig()
  if (!config.enabled) return { ran: false, reason: 'off' }
  const clock = localClock(config.timezone, now)
  if (!timeReached(clock.time, config.time) || config.lastLocalDate === clock.date) return { ran: false, reason: 'not-due' }
  if (!claimGlobalMorning(clock.date)) return { ran: false, reason: 'claimed' }
  globalMorningRunning = true
  try {
    const groups = await participatingGroupIds(sock)
    if (!groups.length) {
      releaseGlobalMorningClaim(clock.date)
      return { ran: false, reason: 'no-groups' }
    }
    let audioBuffer = null
    const audio = resolveDailyAudio(config.audioPath)
    if (audio) {
      try { audioBuffer = await prepareLegacyAudio(audio, logger) } catch (error) {
        logger?.warn?.({ error, audio }, 'áudio do bom dia global indisponível; envio continuará em texto')
      }
    }
    let sent = 0
    let skipped = 0
    let failed = 0
    for (const chat of groups) {
      try {
        const result = await sendGlobalMorningToGroup(sock, chat, config, clock.date, audioBuffer, logger)
        if (result.sent) sent += 1
        else skipped += 1
      } catch (error) {
        failed += 1
        logger?.warn?.({ error, chat, date: clock.date }, 'falha isolada no bom dia global')
      }
    }
    logger?.info?.({ date: clock.date, time: config.time, timezone: config.timezone, groups: groups.length, sent, skipped, failed }, 'varredura do bom dia global concluída')
    return { ran: true, groups: groups.length, sent, skipped, failed }
  } catch (error) {
    releaseGlobalMorningClaim(clock.date)
    throw error
  } finally {
    globalMorningRunning = false
  }
}

export async function testGlobalMorningNow(sock, chat, logger) {
  const config = getGlobalMorningConfig()
  const audio = resolveDailyAudio(config.audioPath)
  let audioBuffer = null
  if (audio) audioBuffer = await prepareLegacyAudio(audio, logger)
  return sendGlobalMorningToGroup(sock, chat, config, `teste-${Date.now()}`, audioBuffer, logger, { force: true })
}

async function sendDailyForGroup(sock, config, logger, now = new Date()) {
  const clock = localClock(config.dailyTimezone, now)
  if (!timeReached(clock.time, config.dailyTime) || config.dailyLastLocalDate === clock.date) return false
  if (isQuietHoursActive(config, now)) return false
  if (!(await hasActiveRental(config.chat))) return false
  if (!claimDailyRun(config.chat, clock.date)) return false
  try {
    const participants = await groupParticipants(sock, config.chat)
    if (!participants.length) throw new Error('Grupo sem participantes disponíveis.')
    await sendMentionChunks(sock, config.chat, participants, config.dailyMessage)
    const audio = resolveDailyAudio(config.dailyAudioPath)
    if (audio) {
      try {
        const buffer = await prepareLegacyAudio(audio, logger)
        await sock.sendMessage(config.chat, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })
      } catch (error) {
        logger?.warn?.({ error, chat: config.chat, audio }, 'mensagem diária enviada, mas o áudio falhou')
      }
    }
    logger?.info?.({ chat: config.chat, date: clock.date, time: config.dailyTime, timezone: config.dailyTimezone, participants: participants.length }, 'rotina diária executada')
    return true
  } catch (error) {
    logger?.warn?.({ error, chat: config.chat, date: clock.date }, 'falha na rotina diária; a data permanece marcada para impedir envio duplicado')
    return false
  }
}

async function sweepGroupSchedules(sock, logger, now = new Date()) {
  if (scheduleRunning || !sock) return
  scheduleRunning = true
  try {
    for (const row of listAllGroupSchedules()) {
      const clock = localClock(row.timezone, now)
      if (!timeReached(clock.time, row.local_time) || row.last_local_date === clock.date) continue
      if (!claimGroupSchedule(row.id, clock.date)) continue
      try {
        await sock.groupSettingUpdate(row.chat, row.action === 'close' ? 'announcement' : 'not_announcement')
        await sock.sendMessage(row.chat, { text: row.action === 'close' ? '🌸 Grupo fechado automaticamente no horário agendado.' : '🌸 Grupo reaberto automaticamente no horário agendado.' })
        logger?.info?.({ chat: row.chat, action: row.action, time: row.local_time, timezone: row.timezone }, 'agendamento do grupo executado')
      } catch (error) { logger?.warn?.({ error, chat: row.chat, action: row.action }, 'falha recuperável no agendamento do grupo') }
    }
  } finally { scheduleRunning = false }
}

async function sweepDaily(sock, logger) {
  if (dailyRunning || !sock) return
  dailyRunning = true
  try {
    await sweepGroupSchedules(sock, logger)
    await runGlobalMorningSweep(sock, logger)
    const configs = listDailyAutomationGroups()
    for (const config of configs) await sendDailyForGroup(sock, config, logger)
  } finally {
    dailyRunning = false
  }
}

export function startGroupAutomationScheduler(sock, logger, intervalMs = settings.automationSweepMs) {
  stopGroupAutomationScheduler()
  void sweepDaily(sock, logger)
  dailyTimer = setInterval(() => void sweepDaily(sock, logger), Math.max(15_000, Number(intervalMs) || 30_000))
  dailyTimer.unref?.()
  return stopGroupAutomationScheduler
}

export function stopGroupAutomationScheduler() {
  if (dailyTimer) clearInterval(dailyTimer)
  dailyTimer = null
  dailyRunning = false
  scheduleRunning = false
  globalMorningRunning = false
  for (const batch of welcomeBatches.values()) clearTimeout(batch.timer)
  welcomeBatches.clear()
  tiktokQueues.clear()
  socialQueues.clear()
}

export async function runDailyAutomationSweepOnce(sock, logger) {
  return sweepDaily(sock, logger)
}

export async function testDailyAutomationNow(sock, chat, logger) {
  const config = getAutomationConfig(chat)
  const participants = await groupParticipants(sock, chat)
  if (!participants.length) throw new Error('Grupo sem participantes disponíveis.')
  await sendMentionChunks(sock, chat, participants, `🌸 TESTE DA ROTINA\n${config.dailyMessage}`)
  const audio = resolveDailyAudio(config.dailyAudioPath)
  if (audio) {
    const buffer = await prepareLegacyAudio(audio, logger)
    await sock.sendMessage(chat, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })
  }
  return { participants: participants.length, audio: Boolean(audio) }
}
