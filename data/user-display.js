import { getContextInfo } from './messages.js'
import { getRememberedUserByIdentity, getRememberedUsers, rememberUser } from './core-store.js'
import { numberFromJid } from './jid.js'

export const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const isPhoneJid = value => /@(s\.whatsapp\.net|hosted)$/i.test(String(value || ''))
const isLidJid = value => /@(lid|hosted\.lid)$/i.test(String(value || ''))

export async function resolveTarget({ sock, msg, args = [], fallbackNumber = '' } = {}) {
  const context = getContextInfo(msg?.message)
  let jid = context?.mentionedJid?.[0]
    || context?.mentionedJids?.[0]
    || context?.participant
    || context?.participantAlt
    || ''
  let number = isPhoneJid(jid) ? numberFromJid(jid) : ''
  number ||= digits(args.find(value => /\d{8,}/.test(String(value || '')))) || digits(fallbackNumber)
  if (jid && isLidJid(jid) && typeof sock?.sakuraResolveNumber === 'function') {
    try { number = digits(await sock.sakuraResolveNumber(jid)) || number } catch {}
  }
  if (!jid && number) jid = `${number}@s.whatsapp.net`
  return { jid, number }
}

function metadataName(participant = {}) {
  return String(participant.notify || participant.name || participant.verifiedName || participant.pushName || '').trim()
}

function jidsOf(participant = {}) {
  return [participant.phoneNumber, participant.participantPn, participant.pn, participant.jid, participant.id, participant.lid].map(String).filter(value => value.includes('@'))
}

function addIdentityAliases(map, identity, aliases = []) {
  const values = [
    identity?.number, identity?.jid, identity?.mentionJid, identity?.phoneJid, identity?.lidJid,
    ...aliases
  ].map(value => String(value || '').trim()).filter(Boolean)
  for (const value of values) {
    map.set(value, identity)
    map.set(value.toLowerCase(), identity)
    const numeric = digits(value)
    if (numeric) map.set(numeric, identity)
  }
}

export async function groupNameMap(sock, chat, metadata = null) {
  const map = new Map()
  let meta = metadata
  if (!meta && String(chat || '').endsWith('@g.us')) {
    try {
      const detail = typeof sock?.sakuraGetGroupMetadata === 'function'
        ? await sock.sakuraGetGroupMetadata(chat, { allowStale: true })
        : { metadata: await sock.groupMetadata(chat) }
      meta = detail?.metadata || detail
    } catch { meta = null }
  }

  const participants = meta?.participants || []
  const candidateNumbers = []
  for (const participant of participants) {
    const jids = jidsOf(participant)
    let number = numberFromJid(participant.phoneNumber || jids.find(isPhoneJid) || '')
    if (!number) {
      const lid = participant.lid || jids.find(isLidJid) || ''
      if (lid && typeof sock?.sakuraResolveNumber === 'function') {
        try { number = digits(await sock.sakuraResolveNumber(lid)) } catch {}
      }
    }
    if (number) candidateNumbers.push(number)
  }

  const remembered = getRememberedUsers(candidateNumbers)
  for (const participant of participants) {
    const jids = jidsOf(participant)
    const phoneJid = String([participant.phoneNumber, participant.participantPn, participant.pn, participant.jid].find(isPhoneJid) || jids.find(isPhoneJid) || '')
    const lidJid = String(participant.lid || jids.find(isLidJid) || '')
    let number = numberFromJid(phoneJid)
    if (!number && lidJid && typeof sock?.sakuraResolveNumber === 'function') {
      try { number = digits(await sock.sakuraResolveNumber(lidJid)) } catch {}
    }
    if (!number) continue

    const liveName = metadataName(participant)
    const old = remembered.get(number)
    const name = liveName || old?.name || ''
    const resolvedPhoneJid = phoneJid || old?.phoneJid || `${number}@s.whatsapp.net`
    const resolvedLidJid = lidJid || old?.lidJid || ''
    const transportJid = String(participant.id || resolvedLidJid || participant.jid || resolvedPhoneJid || old?.jid || '')
    const mentionJid = resolvedPhoneJid || (isPhoneJid(old?.mentionJid) ? old.mentionJid : '') || transportJid
    const identity = { number, jid: transportJid, mentionJid, phoneJid: resolvedPhoneJid, lidJid: resolvedLidJid, name }
    addIdentityAliases(map, identity, jids)
    rememberUser({
      number,
      jid: transportJid,
      mentionJid,
      phoneJid: resolvedPhoneJid,
      lidJid: resolvedLidJid,
      name: liveName,
      source: 'group-metadata'
    })
  }
  return map
}

export function displayUser(value, map = new Map()) {
  const raw = String(value || '').trim()
  const key = digits(raw)
  const item = map.get(raw) || map.get(raw.toLowerCase()) || map.get(key) || getRememberedUserByIdentity(raw || key)
  if (item) {
    const number = digits(item.number || item.phoneJid || item.jid || item.mentionJid)
    const phoneJid = isPhoneJid(item.phoneJid)
      ? item.phoneJid
      : (isPhoneJid(item.mentionJid) ? item.mentionJid : (number ? `${number}@s.whatsapp.net` : ''))
    return { ...item, number, phoneJid, mentionJid: phoneJid || item.mentionJid || item.jid }
  }
  const phoneLike = /@(s\.whatsapp\.net|hosted)$/i.test(raw) || (!raw.includes('@') && key.length >= 10 && key.length <= 15)
  const phoneJid = phoneLike && key ? `${key}@s.whatsapp.net` : ''
  const lidJid = /@(lid|hosted\.lid)$/i.test(raw) ? raw : ''
  return {
    number: phoneLike ? key : '',
    jid: raw.includes('@') ? raw : phoneJid,
    mentionJid: raw.includes('@') ? raw : phoneJid,
    phoneJid,
    lidJid,
    name: ''
  }
}

export function formatMentionName(user) {
  const phone = isPhoneJid(user?.phoneJid)
    ? digits(user.phoneJid)
    : isPhoneJid(user?.jid)
      ? digits(user.jid)
      : (String(user?.number || '').length >= 10 && String(user?.number || '').length <= 15 ? digits(user.number) : '')
  const name = String(user?.name || '').trim()
  if (phone) return name && name !== `@${phone}` ? `${name} (@${phone})` : `@${phone}`
  if (name) return name
  const alias = digits(user?.lidJid || user?.mentionJid || user?.jid)
  return alias ? `Usuário •••${alias.slice(-4)}` : 'Usuário'
}

export async function groupDisplayName(sock, chat, metadata = null) {
  const jid = String(chat || '').trim()
  if (!jid.endsWith('@g.us')) return 'Conversa privada'
  let meta = metadata
  if (!meta) {
    try {
      const detail = typeof sock?.sakuraGetGroupMetadata === 'function'
        ? await sock.sakuraGetGroupMetadata(jid, { allowStale: true })
        : { metadata: await sock.groupMetadata(jid) }
      meta = detail?.metadata || detail
    } catch { meta = null }
  }
  const subject = String(meta?.subject || meta?.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return subject || 'Grupo do WhatsApp'
}
