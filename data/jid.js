import { jidDecode, isLidUser, isPnUser } from '@sakura-md/baileys'

export function onlyDigits(value = '') {
  return String(value ?? '').replace(/\D/g, '')
}

export function numberFromJid(jid = '') {
  const value = String(jid || '')
  const decoded = jidDecode(value)
  const user = decoded?.user || value.split('@')[0] || ''
  return onlyDigits(String(user).split(':')[0])
}

export async function resolveNumber(sock, ...candidates) {
  for (const candidate of candidates.flat().filter(Boolean)) {
    const jid = String(candidate)
    if (isPnUser(jid)) return numberFromJid(jid)
    if (isLidUser(jid) && typeof sock?.sakuraResolveNumber === 'function') {
      try {
        const resolved = await sock.sakuraResolveNumber(jid)
        if (resolved) return onlyDigits(resolved)
      } catch {}
    }
    const fallback = numberFromJid(jid)
    if (fallback) return fallback
  }
  return ''
}

export async function resolveMessageNumbers(sock, msg) {
  const sender = await resolveNumber(
    sock,
    msg?.key?.participantAlt,
    msg?.key?.remoteJidAlt,
    msg?.key?.participant,
    msg?.key?.remoteJid
  )
  const chat = numberFromJid(msg?.key?.remoteJid)
  return { sender, chat }
}

export function normalizeGroupJid(value = '') {
  const raw = String(value || '').trim()
  if (!raw.endsWith('@g.us')) return raw
  const id = raw.split('@')[0].replace(/[^0-9-]/g, '')
  return id ? `${id}@g.us` : raw
}
