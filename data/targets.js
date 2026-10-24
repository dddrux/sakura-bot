import { getContextInfo } from './messages.js'
import { onlyDigits } from './jid.js'
import { resolveTargetIdentityNumber } from './target-resolution.js'

function cleanJid(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^[^@\s]+@(lid|hosted\.lid|s\.whatsapp\.net|hosted)$/i.test(raw)) return raw
  const digits = onlyDigits(raw)
  return digits ? `${digits}@s.whatsapp.net` : ''
}

export function targetCandidates(msg, args = []) {
  const context = getContextInfo(msg?.message)
  const explicit = [
    ...(context?.mentionedJid || []),
    ...(context?.mentionedJids || [])
  ]
  // Em uma resposta, participant/participantAlt identificam o autor da mensagem citada.
  const quoted = [context?.participantAlt, context?.participant]
  const fromArgs = Array.isArray(args) ? args : [args]
  return [...new Set([...explicit, ...quoted, ...fromArgs].map(cleanJid).filter(Boolean))]
}

export function firstTargetJid(msg, args = []) {
  return targetCandidates(msg, args)[0] || ''
}

export function firstTargetNumber(msg, args = []) {
  return onlyDigits(firstTargetJid(msg, args))
}

export function hasQuotedTarget(msg) {
  const context = getContextInfo(msg?.message)
  return Boolean(context?.stanzaId && (context?.participantAlt || context?.participant))
}

export async function resolveTargetNumber(sock, msg, args = [], { metadata = null } = {}) {
  const candidates = targetCandidates(msg, args)
  if (!candidates.length) return ''
  return resolveTargetIdentityNumber(sock, msg?.key?.remoteJid || '', candidates, { metadata })
}
