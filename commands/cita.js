import { defineCommand } from '../data/workstation.js'
import { generateForwardMessageContent, generateWAMessageFromContent, buildSakuraMentionJids } from '@sakura-md/baileys'
import { getQuotedMessage, getMessageType } from '../data/messages.js'
import { reply } from '../data/reply.js'

const mentionCache = new WeakMap()

function botNumbers(sock) {
  return [sock?.user?.id, sock?.user?.lid]
    .map(value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, ''))
    .filter(Boolean)
}

function mentionsFromMetadata(metadata, sock) {
  if (!metadata || typeof metadata !== 'object') return []
  const cached = mentionCache.get(metadata)
  if (cached) return cached
  const mentions = buildSakuraMentionJids(metadata, { exclude: botNumbers(sock) })
  mentionCache.set(metadata, mentions)
  return mentions
}

export default defineCommand({
  name: 'cita',
  aliases: ['citartodos'],
  category: 'Administração',
  description: 'Reenvia a mensagem citada marcando todos pelo caminho rápido.',
  usage: '.cita',
  groupOnly: true,
  adminOnly: true,
  needsMetadata: true,
  fastPath: true,
  skipAfkReferences: true,
  async execute({ sock, msg, metadata, metadataSource: handlerMetadataSource, metadataCacheHit: handlerMetadataCacheHit, logger }) {
    const startedAt = Date.now()
    const quotedStartedAt = Date.now()
    const quoted = getQuotedMessage(msg)
    const quoteMs = Date.now() - quotedStartedAt
    if (!quoted) return reply(sock, msg, '💮 responda a mensagem que deseja citar')

    const chat = msg.key.remoteJid
    const metadataStartedAt = Date.now()
    let resolvedMetadata = metadata
    let metadataSource = metadata ? (handlerMetadataSource || 'handler') : 'none'
    let metadataCacheHit = metadata ? Boolean(handlerMetadataCacheHit) : false

    if (!resolvedMetadata && typeof sock.sakuraGetGroupMetadata === 'function') {
      const detail = await sock.sakuraGetGroupMetadata(chat, { allowStale: true })
      resolvedMetadata = detail.metadata
      metadataSource = detail.source
      metadataCacheHit = detail.cacheHit
    } else if (!resolvedMetadata) {
      resolvedMetadata = await sock.groupMetadata(chat)
      metadataSource = 'groupMetadata'
    }
    const metadataMs = Date.now() - metadataStartedAt

    const mentionsStartedAt = Date.now()
    const mentions = typeof sock.sakuraGetMentionJids === 'function'
      ? await sock.sakuraGetMentionJids(chat, { metadata: resolvedMetadata, exclude: botNumbers(sock) })
      : mentionsFromMetadata(resolvedMetadata, sock)
    const mentionsMs = Date.now() - mentionsStartedAt

    const forwardStartedAt = Date.now()
    const content = generateForwardMessageContent(quoted, true)
    const key = Object.keys(content || {})[0]
    const forwardMs = Date.now() - forwardStartedAt
    if (!key) return reply(sock, msg, '💮 não consegui encaminhar essa mensagem')

    content[key].contextInfo = {
      ...(content[key].contextInfo || {}),
      mentionedJid: mentions
    }

    const generationStartedAt = Date.now()
    const generated = generateWAMessageFromContent(chat, content, {
      userJid: sock.user?.id,
      messageId: undefined
    })
    const generationMs = Date.now() - generationStartedAt

    const relayStartedAt = Date.now()
    await sock.relayMessage(chat, generated.message, { messageId: generated.key.id })
    const relayMs = Date.now() - relayStartedAt

    logger?.success?.({
      command: 'cita',
      chat,
      id: generated.key.id,
      quotedType: getMessageType(quoted.message),
      mentions: mentions.length,
      metadataSource,
      metadataCacheHit,
      quoteMs,
      metadataMs,
      mentionsMs,
      forwardMs,
      generationMs,
      relayMs,
      durationMs: Date.now() - startedAt
    }, 'citação geral enviada pelo caminho rápido')
  }
})
