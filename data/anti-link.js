import { isVip } from './vip.js'
import { isSubowner } from './core-store.js'
import { getProtectionConfig } from './protection-store.js'

const LINK_PATTERN = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|discord(?:app)?\.com\/invite\/|discord\.gg\/|instagram\.com\/|pinterest\.[a-z.]+\/|pin\.it\/)/iu
const warningCooldown = new Map()

function digits(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function participantNumbers(participant = {}) {
  return new Set([
    participant.id,
    participant.phoneNumber,
    participant.pn,
    participant.lid
  ].map(digits).filter(Boolean))
}

function isAdmin(metadata, senderNumber) {
  const target = digits(senderNumber)
  const participant = (metadata?.participants || []).find(item => participantNumbers(item).has(target))
  return participant?.admin === 'admin' || participant?.admin === 'superadmin'
}

function botIsAdmin(sock, metadata) {
  const botNumbers = new Set([sock?.user?.id, sock?.user?.lid].map(digits).filter(Boolean))
  const participant = (metadata?.participants || []).find(item => [...participantNumbers(item)].some(number => botNumbers.has(number)))
  return participant?.admin === 'admin' || participant?.admin === 'superadmin'
}

function canWarn(chat, now = Date.now()) {
  const until = warningCooldown.get(chat) || 0
  if (until > now) return false
  warningCooldown.set(chat, now + 60_000)
  if (warningCooldown.size > 500) warningCooldown.delete(warningCooldown.keys().next().value)
  return true
}

export function containsBlockedLink(text = '') {
  return LINK_PATTERN.test(String(text || ''))
}

export async function maybeEnforceAntiLink({ sock, msg, text, senderNumber, ownerNumber, logger }) {
  const chat = String(msg?.key?.remoteJid || '')
  if (!chat.endsWith('@g.us') || !containsBlockedLink(text)) return false

  const config = getProtectionConfig(chat)
  if (!config.antilinkEnabled) return false
  if (String(senderNumber) === String(ownerNumber) || isSubowner(senderNumber) || await isVip(senderNumber)) return false

  let metadata
  try {
    metadata = await sock.groupMetadata(chat)
  } catch (error) {
    logger?.warn?.({ error, chat, stage: 'antilink-metadata' }, 'não foi possível verificar administradores no antilink')
    return false
  }

  if (isAdmin(metadata, senderNumber)) return false
  if (!botIsAdmin(sock, metadata)) {
    if (canWarn(chat)) {
      await sock.sendMessage(chat, { text: '🌸 O AntiLink está ligado, mas eu preciso ser administradora para apagar links.' }).catch(() => {})
    }
    return false
  }

  try {
    await sock.sendMessage(chat, { delete: msg.key })
    const mention = msg.key.participantAlt || msg.key.participant || `${senderNumber}@s.whatsapp.net`
    await sock.sendMessage(chat, {
      text: `🌸 @${senderNumber}, links não são permitidos neste grupo.`,
      mentions: [mention]
    }).catch(() => {})
    logger?.info?.({ chat, senderNumber, action: 'antilink-delete' }, 'link removido pelo AntiLink')
    return true
  } catch (error) {
    logger?.warn?.({ error, chat, senderNumber, stage: 'antilink-delete' }, 'falha ao apagar link')
    return false
  }
}
