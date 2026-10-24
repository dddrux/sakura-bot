import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase(settings.rentalDb, { version: 3, groups: {}, history: [] })
const now = () => Date.now()
const cleanActor = value => String(value || '').replace(/\D/g, '')
const cleanChat = value => String(value || '').trim()

function clean(row = {}) {
  const permanent = Boolean(row.permanent)
  const expiresAt = Number(row.expiresAt || 0)
  const active = row.active !== false
  return {
    active,
    permanent,
    startedAt: Number(row.startedAt || 0),
    expiresAt,
    createdBy: cleanActor(row.createdBy),
    updatedBy: cleanActor(row.updatedBy),
    updatedAt: Number(row.updatedAt || row.startedAt || 0),
    cancelledAt: Number(row.cancelledAt || 0),
    noticeStage: Number(row.noticeStage || 0),
    valid: active && (permanent || expiresAt > now())
  }
}

function appendHistory(db, event) {
  if (!Array.isArray(db.history)) db.history = []
  db.history.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, at: now(), ...event })
  if (db.history.length > 500) db.history.length = 500
}

function durationInput(duration) {
  if (duration?.permanent) return { permanent: true, ms: 0 }
  const ms = Math.max(60_000, Math.floor(Number(duration?.ms || 0)))
  if (!Number.isSafeInteger(ms)) throw new TypeError('Duração de contrato inválida.')
  return { permanent: false, ms }
}

export async function setRentalDuration(chat, duration, actor = '', { mode = 'set' } = {}) {
  const group = cleanChat(chat)
  if (!group.endsWith('@g.us')) throw new TypeError('Contrato exige um grupo')
  const parsed = durationInput(duration)
  return store.update(db => {
    const at = now()
    const previous = db.groups[group] || null
    const old = clean(previous || {})
    const renew = mode === 'renew' && previous
    const base = renew && old.valid && !old.permanent ? old.expiresAt : at
    const row = {
      active: true,
      permanent: parsed.permanent,
      startedAt: renew ? Number(previous.startedAt || at) : at,
      expiresAt: parsed.permanent ? 0 : base + parsed.ms,
      createdBy: cleanActor(previous?.createdBy || actor),
      updatedBy: cleanActor(actor),
      updatedAt: at,
      cancelledAt: 0,
      noticeStage: 0
    }
    db.version = Math.max(3, Number(db.version || 0))
    db.groups[group] = row
    appendHistory(db, {
      type: renew ? 'renew' : 'set', chat: group, actor: cleanActor(actor),
      previousExpiresAt: old.expiresAt || 0, expiresAt: row.expiresAt, permanent: row.permanent
    })
    return { chat: group, ...clean(row) }
  })
}

export async function setRental(chat, days = 30, permanent = false, actor = '') {
  return setRentalDuration(chat, { permanent: Boolean(permanent), ms: Math.max(1, Number(days) || 30) * 86_400_000 }, actor, { mode: 'set' })
}

export async function renewRental(chat, duration, actor = '') {
  return setRentalDuration(chat, duration, actor, { mode: 'renew' })
}

export async function cancelRental(chat, actor = '', reason = 'cancelled') {
  const group = cleanChat(chat)
  return store.update(db => {
    const previous = db.groups[group]
    if (!previous) return null
    const at = now()
    previous.active = false
    previous.cancelledAt = at
    previous.updatedAt = at
    previous.updatedBy = cleanActor(actor)
    appendHistory(db, { type: reason, chat: group, actor: cleanActor(actor), expiresAt: Number(previous.expiresAt || 0), permanent: Boolean(previous.permanent) })
    return { chat: group, ...clean(previous) }
  })
}

export async function removeRental(chat, actor = '') {
  return cancelRental(chat, actor, 'removed')
}

export async function getRental(chat) {
  const db = await store.read()
  const row = db.groups[cleanChat(chat)]
  return row ? { chat: cleanChat(chat), ...clean(row) } : null
}

export async function hasActiveRental(chat) { return Boolean((await getRental(chat))?.valid) }

export async function listRentals({ activeOnly = false } = {}) {
  const db = await store.read()
  const rows = Object.entries(db.groups || {}).map(([chat, row]) => ({ chat, ...clean(row) }))
  return activeOnly ? rows.filter(row => row.valid) : rows
}

export async function rentalHistory(chat = '', limit = 30) {
  const db = await store.read()
  const group = cleanChat(chat)
  return (db.history || []).filter(row => !group || row.chat === group).slice(0, Math.max(1, Math.min(100, Number(limit) || 30)))
}

function stageFor(row, at) {
  if (!row.active || row.permanent) return 0
  const remaining = Number(row.expiresAt || 0) - at
  if (remaining <= 0) return 4
  if (remaining <= 3_600_000) return 3
  if (remaining <= 86_400_000) return 2
  if (remaining <= 3 * 86_400_000) return 1
  return 0
}

export async function collectRentalNotices(at = now()) {
  return store.update(db => {
    const notices = []
    for (const [chat, raw] of Object.entries(db.groups || {})) {
      const row = raw || {}
      const stage = stageFor(row, at)
      if (!stage || stage <= Number(row.noticeStage || 0)) continue
      row.noticeStage = stage
      row.updatedAt = at
      if (stage === 4) {
        row.active = false
        appendHistory(db, { type: 'expired', chat, actor: '', expiresAt: Number(row.expiresAt || 0), permanent: false })
      }
      notices.push({ chat, stage, expired: stage === 4, ...clean(row) })
    }
    return notices
  })
}
