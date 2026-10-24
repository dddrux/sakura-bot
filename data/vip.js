import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase(settings.vipDb, { version: 2, users: {}, history: [] })
const now = () => Date.now()
const digits = value => String(value || '').replace(/\D/g, '')

function cleanRow(row = {}) {
  const permanent = Boolean(row.permanent)
  const expiresAt = Number(row.expiresAt || 0)
  const active = row.active !== false
  return {
    active,
    permanent,
    startedAt: Number(row.startedAt || 0),
    expiresAt,
    createdBy: digits(row.createdBy),
    updatedBy: digits(row.updatedBy),
    updatedAt: Number(row.updatedAt || row.startedAt || 0),
    cancelledAt: Number(row.cancelledAt || 0),
    noticeStage: Number(row.noticeStage || 0),
    plan: String(row.plan || ''),
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
  if (!Number.isSafeInteger(ms)) throw new TypeError('Duração VIP inválida.')
  return { permanent: false, ms }
}

export async function setVipDuration(number, duration, actor = '', { mode = 'set', plan = '' } = {}) {
  const key = digits(number)
  if (!key) throw new TypeError('Número VIP inválido')
  const parsed = durationInput(duration)
  return store.update(db => {
    const at = now()
    const previous = db.users[key] || null
    const old = cleanRow(previous || {})
    const renew = mode === 'renew' && previous
    const base = renew && old.valid && !old.permanent ? old.expiresAt : at
    const row = {
      active: true,
      permanent: parsed.permanent,
      startedAt: renew ? Number(previous.startedAt || at) : at,
      expiresAt: parsed.permanent ? 0 : base + parsed.ms,
      createdBy: digits(previous?.createdBy || actor),
      updatedBy: digits(actor),
      updatedAt: at,
      cancelledAt: 0,
      noticeStage: 0,
      plan: String(plan || previous?.plan || '')
    }
    db.version = Math.max(2, Number(db.version || 0))
    db.users[key] = row
    appendHistory(db, { type: renew ? 'renew' : 'set', number: key, actor: digits(actor), previousExpiresAt: old.expiresAt || 0, expiresAt: row.expiresAt, permanent: row.permanent, plan: row.plan })
    return { number: key, ...cleanRow(row) }
  })
}

export async function setVip(number, days = 30, permanent = false, actor = '') {
  return setVipDuration(number, { permanent: Boolean(permanent), ms: Math.max(1, Number(days) || 30) * 86_400_000 }, actor, { mode: 'set' })
}

export async function renewVip(number, duration, actor = '') {
  return setVipDuration(number, duration, actor, { mode: 'renew' })
}

export async function cancelVip(number, actor = '', reason = 'cancelled') {
  const key = digits(number)
  if (!key) return null
  return store.update(db => {
    const old = db.users[key]
    if (!old) return null
    const at = now()
    old.active = false
    old.cancelledAt = at
    old.updatedAt = at
    old.updatedBy = digits(actor)
    appendHistory(db, { type: reason, number: key, actor: digits(actor), expiresAt: Number(old.expiresAt || 0), permanent: Boolean(old.permanent) })
    return { number: key, ...cleanRow(old) }
  })
}

export async function removeVip(number, actor = '') {
  return cancelVip(number, actor, 'removed')
}

export async function getVip(number) {
  const key = digits(number)
  if (!key) return null
  const db = await store.read()
  const row = db.users[key]
  return row ? { number: key, ...cleanRow(row) } : null
}

export async function isVip(number) {
  return Boolean((await getVip(number))?.valid)
}

export async function listVips({ activeOnly = true } = {}) {
  const db = await store.read()
  const rows = Object.entries(db.users || {}).map(([number, row]) => ({ number, ...cleanRow(row) }))
  return activeOnly ? rows.filter(row => row.valid) : rows
}

export async function vipHistory(number = '', limit = 30) {
  const db = await store.read()
  const key = digits(number)
  return (db.history || []).filter(row => !key || row.number === key).slice(0, Math.max(1, Math.min(100, Number(limit) || 30)))
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

export async function collectVipNotices(at = now()) {
  return store.update(db => {
    const notices = []
    for (const [number, raw] of Object.entries(db.users || {})) {
      const row = raw || {}
      const stage = stageFor(row, at)
      if (!stage || stage <= Number(row.noticeStage || 0)) continue
      row.noticeStage = stage
      row.updatedAt = at
      if (stage === 4) {
        row.active = false
        appendHistory(db, { type: 'expired', number, actor: '', expiresAt: Number(row.expiresAt || 0), permanent: false })
      }
      notices.push({ number, stage, expired: stage === 4, ...cleanRow(row) })
    }
    return notices
  })
}

export function vipPlan(planKey = '') {
  const key = String(planKey || '').trim().toLowerCase()
  return (settings.vipPlans || []).find(plan => String(plan.key || '').toLowerCase() === key) || null
}

export function vipBenefits(planKey = '') {
  const plan = vipPlan(planKey)
  return Object.freeze({
    plan: plan?.key || '',
    planName: plan?.name || 'VIP',
    mediaLimitMb: Number(plan?.mediaLimitMb || settings.vipMediaLimitMb),
    freeMediaLimitMb: settings.freeMediaLimitMb,
    dailyMultiplier: Number(plan?.dailyMultiplier || settings.vipDailyMultiplier),
    workMultiplier: Number(plan?.workMultiplier || settings.vipWorkMultiplier),
    mediaPriority: true,
    priorityMultiplier: Number(plan?.priorityMultiplier || settings.vipPriorityMultiplier),
    currencyName: settings.currencyName,
    currencyEmoji: settings.currencyEmoji
  })
}


export async function getVipBenefits(number = '') {
  const row = await getVip(number)
  const active = Boolean(row?.valid)
  const benefits = vipBenefits(active ? row.plan : '')
  return Object.freeze({
    active,
    row,
    plan: active ? benefits.plan : '',
    planName: active ? benefits.planName : 'Gratuito',
    mediaLimitMb: active ? benefits.mediaLimitMb : benefits.freeMediaLimitMb,
    freeMediaLimitMb: benefits.freeMediaLimitMb,
    dailyMultiplier: active ? benefits.dailyMultiplier : 1,
    workMultiplier: active ? benefits.workMultiplier : 1,
    mediaPriority: active,
    priorityMultiplier: active ? benefits.priorityMultiplier : 1,
    currencyName: benefits.currencyName,
    currencyEmoji: benefits.currencyEmoji
  })
}

