import { getRememberedUserByIdentity, rememberUser } from './core-store.js'
import { numberFromJid, onlyDigits } from './jid.js'

const PN_SUFFIXES = ['@s.whatsapp.net', '@hosted']
const TEXT_KEYS = new Set(['text', 'caption', 'contentText', 'selectedDisplayText', 'description', 'title'])

function cleanJid(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw
  const number = onlyDigits(raw)
  return number ? `${number}@s.whatsapp.net` : ''
}

function isPnJid(value = '') {
  const jid = String(value || '')
  return PN_SUFFIXES.some(suffix => jid.endsWith(suffix))
}

function isLidJid(value = '') {
  return /@(lid|hosted\.lid)$/i.test(String(value || ''))
}

function participantName(participant = {}) {
  return String(
    participant.notify ||
    participant.name ||
    participant.verifiedName ||
    participant.pushName ||
    ''
  ).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80)
}

function participantJids(participant = {}) {
  return [participant.phoneNumber, participant.participantPn, participant.pn, participant.jid, participant.id, participant.lid]
    .map(cleanJid)
    .filter(Boolean)
}

function participantIdentity(participant = {}) {
  const jids = participantJids(participant)
  const phoneJid = [participant.phoneNumber, participant.participantPn, participant.pn, participant.jid]
    .map(cleanJid)
    .find(isPnJid) || jids.find(isPnJid) || ''
  const lidJid = cleanJid(participant.lid) || jids.find(isLidJid) || ''
  // A marcação visível usa @número, então o PN precisa ser o mentionedJid principal.
  // O LID continua guardado apenas como alias/rota alternativa.
  const transportJid = cleanJid(participant.id) || lidJid || cleanJid(participant.jid) || phoneJid
  const mentionJid = phoneJid || transportJid
  return {
    number: numberFromJid(phoneJid),
    jid: transportJid,
    phoneJid,
    lidJid,
    mentionJid,
    name: participantName(participant),
    allJids: jids
  }
}

async function getGroupMetadata(sock, chatJid, supplied = null) {
  if (supplied?.participants) return supplied
  if (!String(chatJid || '').endsWith('@g.us')) return null
  try {
    if (typeof sock?.sakuraGetGroupMetadata === 'function') {
      const detail = await sock.sakuraGetGroupMetadata(chatJid, { allowStale: true })
      return detail?.metadata || detail || null
    }
    return await sock?.groupMetadata?.(chatJid)
  } catch {
    return null
  }
}

async function buildIdentityIndex(sock, chatJid, suppliedMetadata = null) {
  const metadata = await getGroupMetadata(sock, chatJid, suppliedMetadata)
  const exact = new Map()
  const byPhone = new Map()
  const byLid = new Map()
  const identities = []

  for (const participant of metadata?.participants || []) {
    const identity = participantIdentity(participant)
    if (!identity.mentionJid) continue

    if (!identity.number && identity.lidJid && typeof sock?.sakuraResolveNumber === 'function') {
      try {
        identity.number = onlyDigits(await sock.sakuraResolveNumber(identity.lidJid))
        if (identity.number && !identity.phoneJid) identity.phoneJid = `${identity.number}@s.whatsapp.net`
      } catch {}
    }
    if (identity.phoneJid) identity.mentionJid = identity.phoneJid

    identities.push(identity)
    for (const jid of identity.allJids) exact.set(jid.toLowerCase(), identity)
    if (identity.mentionJid) exact.set(identity.mentionJid.toLowerCase(), identity)
    if (identity.number) byPhone.set(identity.number, identity)
    if (identity.lidJid) byLid.set(numberFromJid(identity.lidJid), identity)

    if (identity.number) {
      try {
        rememberUser({
          number: identity.number,
          jid: identity.jid || identity.lidJid || identity.mentionJid,
          mentionJid: identity.mentionJid,
          phoneJid: identity.phoneJid,
          lidJid: identity.lidJid,
          name: identity.name,
          source: 'group-metadata'
        })
      } catch {}
    }
  }

  return { metadata, exact, byPhone, byLid, identities }
}

function rememberedIdentity(candidate) {
  const number = numberFromJid(candidate) || onlyDigits(candidate)
  if (!number) return null
  const row = getRememberedUserByIdentity(candidate)
  if (!row) return null
  const rememberedNumber = onlyDigits(row.number || number)
  const phoneJid = cleanJid(row.phoneJid || (rememberedNumber ? `${rememberedNumber}@s.whatsapp.net` : ''))
  const mentionJid = phoneJid || cleanJid(row.mentionJid || row.jid || row.lidJid)
  return {
    number: rememberedNumber,
    phoneJid,
    lidJid: cleanJid(row.lidJid),
    mentionJid,
    name: String(row.name || '').trim(),
    allJids: [row.jid, row.mentionJid, row.phoneJid, row.lidJid].map(cleanJid).filter(Boolean),
    remembered: true
  }
}

function fallbackIdentity(candidate) {
  const jid = cleanJid(candidate)
  const number = isPnJid(jid) ? numberFromJid(jid) : ''
  return {
    number,
    phoneJid: number ? `${number}@s.whatsapp.net` : '',
    lidJid: isLidJid(jid) ? jid : '',
    mentionJid: jid,
    name: '',
    allJids: jid ? [jid] : [],
    fallback: true
  }
}

export async function resolveMentionIdentities(sock, chatJid, candidates = [], { metadata = null } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(String).filter(Boolean)
  if (!list.length) return []
  const group = String(chatJid || '').endsWith('@g.us')
  const index = group ? await buildIdentityIndex(sock, chatJid, metadata) : null
  const output = []

  for (const candidate of list) {
    const rawJid = cleanJid(candidate)
    const rawNumber = numberFromJid(rawJid) || onlyDigits(candidate)
    let identity = index?.exact.get(rawJid.toLowerCase()) || null

    if (!identity && isLidJid(rawJid)) identity = index?.byLid.get(numberFromJid(rawJid)) || null
    if (!identity && rawNumber && !isLidJid(rawJid)) identity = index?.byPhone.get(rawNumber) || null
    if (!identity) identity = rememberedIdentity(candidate)
    if (!identity) identity = fallbackIdentity(candidate)

    if (!identity.number && identity.lidJid && typeof sock?.sakuraResolveNumber === 'function') {
      try { identity.number = onlyDigits(await sock.sakuraResolveNumber(identity.lidJid)) } catch {}
    }
    if (identity.number && !identity.phoneJid) identity.phoneJid = `${identity.number}@s.whatsapp.net`
    if (identity.phoneJid) identity.mentionJid = identity.phoneJid
    output.push({ ...identity, input: candidate })
  }

  return output
}

export async function resolveMentionJids(sock, chatJid, candidates = [], options = {}) {
  const identities = await resolveMentionIdentities(sock, chatJid, candidates, options)
  return [...new Set(identities.map(item => item.mentionJid).filter(Boolean))]
}

function findMentionArrays(value, slots = [], seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return slots
  if (seen.has(value)) return slots
  seen.add(value)

  for (const [key, child] of Object.entries(value)) {
    if ((key === 'mentions' || key === 'mentionedJid' || key === 'mentionedJids') && Array.isArray(child)) {
      slots.push({ owner: value, key, values: child.map(String).filter(Boolean) })
      continue
    }
    findMentionArrays(child, slots, seen)
  }
  return slots
}

function replaceMentionText(value, replacements, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return
  if (seen.has(value)) return
  seen.add(value)

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && TEXT_KEYS.has(key)) {
      let text = child
      for (const [from, to] of replacements) {
        if (!from || !to || from === to) continue
        text = text.replace(new RegExp(`@${from}(?!\\d)`, 'g'), `@${to}`)
      }
      value[key] = text
      continue
    }
    if (child && typeof child === 'object') replaceMentionText(child, replacements, seen)
  }
}

export async function normalizeOutgoingMentions(sock, chatJid, payload, { metadata = null } = {}) {
  const slots = findMentionArrays(payload)
  if (!slots.length) return { payload, changed: false, requested: 0, resolved: 0, unresolved: 0 }

  const uniqueInputs = [...new Set(slots.flatMap(slot => slot.values))]
  const identities = await resolveMentionIdentities(sock, chatJid, uniqueInputs, { metadata })
  const map = new Map(identities.map(identity => [identity.input, identity]))
  const replacements = new Map()
  let changed = false
  let unresolved = 0

  for (const slot of slots) {
    const normalized = []
    for (const input of slot.values) {
      const identity = map.get(input) || fallbackIdentity(input)
      const jid = identity.mentionJid || cleanJid(input)
      if (!jid) {
        unresolved += 1
        continue
      }
      normalized.push(jid)
      const oldDigits = numberFromJid(input) || onlyDigits(input)
      if (oldDigits && identity.number) replacements.set(oldDigits, identity.number)
      if (jid !== input) changed = true
      if (identity.fallback) unresolved += 1
    }
    const deduped = [...new Set(normalized)]
    if (deduped.length !== slot.values.length) changed = true
    slot.owner[slot.key] = deduped
  }

  if (replacements.size) replaceMentionText(payload, replacements)
  return {
    payload,
    changed,
    requested: uniqueInputs.length,
    resolved: Math.max(0, uniqueInputs.length - unresolved),
    unresolved,
    replacements: replacements.size
  }
}

export function installMentionResolver(sock, logger) {
  if (!sock || sock.sakuraMentionResolverInstalled) return sock

  const rawSendMessage = typeof sock.sendMessage === 'function' ? sock.sendMessage.bind(sock) : null
  const rawRelayMessage = typeof sock.relayMessage === 'function' ? sock.relayMessage.bind(sock) : null

  if (rawSendMessage) {
    sock.sendMessage = async (jid, content, options = {}) => {
      // Não regrave o EXIF aqui. Comandos de criação usam o nome real do
      // remetente, enquanto auto-respostas usam a identidade fixa do bot.
      const result = await normalizeOutgoingMentions(sock, jid, content)
      if (result.changed || result.unresolved) {
        logger?.debug?.({
          chatJid: jid,
          stage: 'mention-normalize-send',
          mentions: result.requested,
          resolved: result.resolved,
          unresolved: result.unresolved,
          replacements: result.replacements
        }, 'menções normalizadas antes do envio')
      }
      return rawSendMessage(jid, result.payload, options)
    }
  }

  if (rawRelayMessage) {
    sock.relayMessage = async (jid, message, options = {}) => {
      const result = await normalizeOutgoingMentions(sock, jid, message)
      if (result.changed || result.unresolved) {
        logger?.debug?.({
          chatJid: jid,
          stage: 'mention-normalize-relay',
          mentions: result.requested,
          resolved: result.resolved,
          unresolved: result.unresolved,
          replacements: result.replacements
        }, 'menções normalizadas no relay')
      }
      return rawRelayMessage(jid, result.payload, options)
    }
  }

  Object.defineProperty(sock, 'sakuraMentionResolverInstalled', { value: true, enumerable: false })
  Object.defineProperty(sock, 'sakuraResolveMentionJids', {
    value: (jid, candidates, options) => resolveMentionJids(sock, jid, candidates, options),
    enumerable: false
  })
  Object.defineProperty(sock, 'sakuraResolveMentionIdentities', {
    value: (jid, candidates, options) => resolveMentionIdentities(sock, jid, candidates, options),
    enumerable: false
  })
  return sock
}
