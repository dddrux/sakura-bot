import fs from 'node:fs/promises'
import path from 'node:path'
import { readConfig, settings, writeConfigSync } from './settings.js'

export function releaseVersionFromText(text = '') {
  return String(text || '').match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] || ''
}

function inviteCode(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^[A-Za-z0-9_-]{12,}$/.test(text)) return text
  try {
    const url = new URL(text)
    const parts = url.pathname.split('/').filter(Boolean)
    const index = parts.findIndex(item => item.toLowerCase() === 'channel')
    return index >= 0 ? String(parts[index + 1] || '') : String(parts.at(-1) || '')
  } catch { return '' }
}

function nodeChildren(node) {
  return Array.isArray(node?.content) ? node.content.filter(item => item && typeof item === 'object' && item.tag) : []
}

function flattenNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.tag) out.push(node)
  for (const child of nodeChildren(node)) flattenNodes(child, out)
  return out
}

function messageText(message = {}) {
  return String(
    message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
    || message.documentMessage?.caption
    || ''
  )
}

export function newsletterTextsFromNode(node, baileys = {}) {
  const { proto, getBinaryNodeChild } = baileys
  if (!proto?.Message || typeof getBinaryNodeChild !== 'function') return []
  const texts = []
  for (const item of flattenNodes(node)) {
    if (item.tag !== 'message') continue
    const plaintext = getBinaryNodeChild(item, 'plaintext')
    if (!plaintext?.content) continue
    try {
      const bytes = typeof plaintext.content === 'string' ? Buffer.from(plaintext.content, 'binary') : Buffer.from(plaintext.content)
      const decoded = proto.Message.decode(bytes).toJSON()
      const text = messageText(decoded).trim()
      if (text) texts.push(text)
    } catch {}
  }
  return texts
}

async function releaseNotes() {
  const fallback = `🌸 *Sakura-MD ${settings.release}*\n\nNova versão da Sakura disponível. Use *.changelog* para ver as mudanças.`
  try {
    const raw = await fs.readFile(path.join(settings.rootDir, 'RELEASE-NOTES.md'), 'utf8')
    const body = raw.trim().slice(0, 6000)
    if (!body) return fallback
    return `🌸 *Sakura-MD ${settings.release}*\n\n${body}`
  } catch { return fallback }
}

function persistAnnouncement(version, channelJid = '', messageId = '') {
  const current = readConfig()
  writeConfigSync({
    releaseAnnouncements: {
      ...(current.releaseAnnouncements || {}),
      lastAnnouncedVersion: version,
      lastChannelJid: channelJid,
      lastMessageId: messageId,
      lastAnnouncedAt: Date.now()
    }
  })
}

export async function announceReleaseIfNeeded(sock, logger) {
  const config = readConfig()
  const release = String(config.bot?.release || settings.release || '').trim()
  const state = config.releaseAnnouncements || {}
  if (state.enabled === false || !release) return { announced: false, reason: 'disabled' }
  const channel = String(state.channel || config.ui?.updateChannel || settings.updateChannel || '').trim()
  const code = inviteCode(channel)
  if (!code && !String(state.channelJid || '').endsWith('@newsletter')) return { announced: false, reason: 'channel-not-configured' }

  try {
    const baileys = await import('@sakura-md/baileys')
    const metadata = String(state.channelJid || '').endsWith('@newsletter')
      ? await sock.newsletterMetadata?.('jid', state.channelJid)
      : await sock.newsletterMetadata?.('invite', code)
    const jid = String(metadata?.id || state.channelJid || '')
    if (!jid.endsWith('@newsletter')) return { announced: false, reason: 'channel-unresolved' }
    const role = String(metadata?.viewer_metadata?.role || metadata?.viewerMetadata?.role || '').toUpperCase()
    if (role && !['ADMIN', 'OWNER'].includes(role)) {
      logger?.info?.({ channel: jid, role }, 'release automático aguardando Sakura virar administradora do canal')
      return { announced: false, reason: 'not-admin' }
    }

    // O canal é a fonte principal de deduplicação. Mesmo que o config seja
    // substituído por uma build nova, uma nota já publicada não é repetida.
    let recentTexts = []
    try {
      const node = await sock.newsletterFetchMessages?.(jid, 20)
      recentTexts = newsletterTextsFromNode(node, baileys)
    } catch (error) {
      logger?.debug?.({ error, channel: jid }, 'histórico recente do canal indisponível; usando estado local de release')
    }
    const alreadyInChannel = recentTexts.some(text => releaseVersionFromText(text) === release)
    if (alreadyInChannel || String(state.lastAnnouncedVersion || '') === release) {
      if (alreadyInChannel && state.lastAnnouncedVersion !== release) persistAnnouncement(release, jid, state.lastMessageId || '')
      return { announced: false, reason: 'already-announced', channelJid: jid }
    }

    const text = await releaseNotes()
    const sent = await sock.sendMessage(jid, { text })
    const messageId = String(sent?.key?.id || '')
    persistAnnouncement(release, jid, messageId)
    logger?.success?.({ release, channel: jid, messageId }, 'nota de atualização publicada automaticamente no canal')
    return { announced: true, channelJid: jid, messageId }
  } catch (error) {
    // Canal é recurso auxiliar: nunca derruba o socket nem inicia loop de reconnect.
    logger?.warn?.({ error, release, stage: 'release-announcer' }, 'não foi possível publicar/verificar a nota de atualização')
    return { announced: false, reason: 'error', error }
  }
}
