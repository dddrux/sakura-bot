import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { isSubowner } from './core-store.js'

const DEFAULTS = Object.freeze({
  message: { enabled: true, maxAttempts: 3, windowMs: 24 * 60 * 60_000 },
  call: { enabled: true, maxAttempts: 3, windowMs: 7 * 24 * 60 * 60_000 }
})
const store = openDatabase(settings.privateProtectionDb, { version: 2, configs: {}, attempts: {}, allowlist: {} })
const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const normalizeKind = value => String(value || '').toLowerCase().startsWith('call') ? 'call' : 'message'
const cleanJid = value => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw
  const number = digits(raw)
  return number ? `${number}@s.whatsapp.net` : ''
}
const attemptKey = (jid, kind) => `${cleanJid(jid)}|${normalizeKind(kind)}`

export function getPrivateProtectionConfig(kind = 'message') {
  const key = normalizeKind(kind)
  const fallback = DEFAULTS[key]
  const row = store.readSync().configs?.[key] || {}
  return {
    kind: key,
    enabled: row.enabled == null ? fallback.enabled : Boolean(row.enabled),
    maxAttempts: Math.max(2, Number(row.maxAttempts || fallback.maxAttempts)),
    windowMs: Math.max(60_000, Number(row.windowMs || fallback.windowMs)),
    actor: String(row.actor || ''),
    updatedAt: Number(row.updatedAt || 0)
  }
}

export function updatePrivateProtectionConfig(kind, patch = {}, actor = '') {
  const current = getPrivateProtectionConfig(kind)
  const next = {
    ...current,
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    maxAttempts: patch.maxAttempts == null ? current.maxAttempts : Math.max(2, Math.min(10, Math.round(Number(patch.maxAttempts) || current.maxAttempts))),
    windowMs: patch.windowMs == null ? current.windowMs : Math.max(60_000, Math.min(30 * 24 * 60 * 60_000, Math.round(Number(patch.windowMs) || current.windowMs))),
    actor: digits(actor),
    updatedAt: Date.now()
  }
  store.updateSync(db => { db.configs ||= {}; db.configs[current.kind] = next })
  return getPrivateProtectionConfig(current.kind)
}

export function isPrivateProtectionAllowed(jid) {
  const key = cleanJid(jid)
  return Boolean(key && store.readSync().allowlist?.[key])
}

export function addPrivateProtectionAllow(jid, actor = '', note = '') {
  const key = cleanJid(jid)
  if (!key || key.endsWith('@g.us')) throw new TypeError('Contato inválido para a lista permitida.')
  store.updateSync(db => {
    db.allowlist ||= {}
    db.allowlist[key] = { jid: key, actor: digits(actor), note: String(note || '').slice(0, 160), created_at: Date.now() }
  })
  return key
}

export function removePrivateProtectionAllow(jid) {
  const key = cleanJid(jid)
  let changes = 0
  store.updateSync(db => { if (db.allowlist?.[key]) { delete db.allowlist[key]; changes = 1 } })
  return changes
}

export function listPrivateProtectionAllow(limit = 50) {
  return Object.values(store.readSync().allowlist || {})
    .sort((a, b) => Number(b.created_at) - Number(a.created_at))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)))
    .map(row => ({ ...row }))
}

export function registerPrivateAttempt(jid, kind, options = {}) {
  const key = cleanJid(jid)
  const normalizedKind = normalizeKind(kind)
  const config = getPrivateProtectionConfig(normalizedKind)
  const windowMs = Math.max(60_000, Number(options.windowMs || config.windowMs))
  const maxAttempts = Math.max(2, Number(options.maxAttempts || config.maxAttempts))
  const now = Date.now()
  let result
  store.updateSync(db => {
    db.attempts ||= {}
    const mapKey = attemptKey(key, normalizedKind)
    const old = db.attempts[mapKey]
    const sameWindow = Boolean(old && now - Number(old.last_at) <= windowMs)
    const attempts = sameWindow ? Number(old.attempts) + 1 : 1
    const firstAt = sameWindow ? Number(old.first_at) : now
    db.attempts[mapKey] = {
      jid: key, kind: normalizedKind, attempts, first_at: firstAt, last_at: now,
      blocked_at: old?.blocked_at || null
    }
    result = { attempts, maxAttempts, shouldBlock: attempts >= maxAttempts, firstAt, lastAt: now }
  })
  return result
}

export function markPrivateBlocked(jid, kind) {
  store.updateSync(db => {
    const row = db.attempts?.[attemptKey(jid, kind)]
    if (row) row.blocked_at = Date.now()
  })
}

export function resetPrivateProtection(jid, kind = '') {
  const key = cleanJid(jid)
  if (!key) return 0
  let changes = 0
  store.updateSync(db => {
    db.attempts ||= {}
    for (const [mapKey, row] of Object.entries(db.attempts)) {
      if (row.jid === key && (!kind || row.kind === normalizeKind(kind))) {
        delete db.attempts[mapKey]
        changes += 1
      }
    }
  })
  return changes
}

export function listPrivateProtectionAttempts(kind = '', limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30))
  const normalized = kind ? normalizeKind(kind) : ''
  return Object.values(store.readSync().attempts || {})
    .filter(row => !normalized || row.kind === normalized)
    .sort((a, b) => Number(b.last_at) - Number(a.last_at))
    .slice(0, safeLimit)
    .map(row => ({ ...row }))
}

export function privateProtectionStatus() {
  const db = store.readSync()
  const attempts = Object.values(db.attempts || {})
  return {
    message: getPrivateProtectionConfig('message'),
    call: getPrivateProtectionConfig('call'),
    tracked: attempts.length,
    blocked: attempts.filter(row => row.blocked_at != null).length,
    allowed: Object.keys(db.allowlist || {}).length
  }
}

function ownerOrSubowner(jid) {
  const number = digits(jid)
  return number && (number === digits(settings.ownerNumber) || isSubowner(number))
}

export async function enforcePrivateMessageProtection({ sock, msg, senderNumber, isOwner = false, isSubowner: senderIsSubowner = false, logger }) {
  const chat = String(msg?.key?.remoteJid || '')
  const config = getPrivateProtectionConfig('message')
  if (!config.enabled || !chat || chat.endsWith('@g.us') || chat === 'status@broadcast' || isOwner || senderIsSubowner || ownerOrSubowner(chat) || isPrivateProtectionAllowed(chat)) return false
  const result = registerPrivateAttempt(chat, 'message', config)
  try {
    if (result.shouldBlock) {
      await sock.sendMessage(chat, { text: `🌸 Você recebeu ${result.maxAttempts - 1} aviso(s). Para proteger o número da Sakura, este contato será bloqueado.` }, { quoted: msg }).catch(() => {})
      await sock.updateBlockStatus(chat, 'block')
      markPrivateBlocked(chat, 'message')
      logger?.warn?.({ chat, senderNumber, attempts: result.attempts }, 'contato bloqueado pelo Anti-PV')
    } else {
      const remaining = result.maxAttempts - result.attempts
      const text = result.attempts === 1
        ? `🌸 Este número não oferece atendimento no privado. Use a Sakura em um grupo autorizado. Primeiro aviso; restam ${remaining} tentativa(s).`
        : `🌸 Aviso ${result.attempts}/${result.maxAttempts}: não envie mensagens no privado. Restam ${remaining} tentativa(s) antes do bloqueio.`
      await sock.sendMessage(chat, { text }, { quoted: msg })
    }
  } catch (error) {
    logger?.warn?.({ error, chat }, 'falha recuperável no Anti-PV')
  }
  return true
}

export async function handleIncomingCalls(sock, calls = [], logger) {
  const config = getPrivateProtectionConfig('call')
  if (!config.enabled) return
  for (const call of calls || []) {
    const from = String(call?.from || call?.chatId || call?.callerPn || '')
    const id = String(call?.id || call?.callId || '')
    if (!from || from.endsWith('@g.us') || call?.isGroup || ownerOrSubowner(from) || isPrivateProtectionAllowed(from)) continue
    try { if (id && typeof sock.rejectCall === 'function') await sock.rejectCall(id, from) } catch (error) { logger?.debug?.({ error, from, id }, 'chamada não pôde ser recusada') }
    const result = registerPrivateAttempt(from, 'call', config)
    try {
      if (result.shouldBlock) {
        await sock.updateBlockStatus(from, 'block')
        markPrivateBlocked(from, 'call')
      } else {
        const remaining = result.maxAttempts - result.attempts
        await sock.sendMessage(from, { text: result.attempts === 1 ? `🌸 A Sakura não atende chamadas. Primeira tentativa; restam ${remaining} antes do bloqueio.` : `🌸 Tentativa ${result.attempts}/${result.maxAttempts}. Restam ${remaining} antes do bloqueio automático.` }).catch(() => {})
      }
    } catch (error) { logger?.warn?.({ error, from }, 'falha recuperável no anti-chamadas') }
  }
}

export function closePrivateProtectionStore() {}
