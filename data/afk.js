import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { formatMessage } from './formatter.js'

const defaults = { version: 1, groups: {} }
const store = openDatabase(settings.afkDb, defaults)
const activeCache = new Map()
let cacheReady = null

async function ensureCache() {
  if (cacheReady) return cacheReady
  cacheReady = (async () => {
    const db = await store.read()
    activeCache.clear()
    for (const [group, records] of Object.entries(db.groups || {})) {
      const users = new Map()
      for (const [number, record] of Object.entries(records || {})) users.set(cleanNumber(number), normalizeRecord(number, record))
      if (users.size) activeCache.set(cleanNumber(group), users)
    }
    return activeCache
  })().catch(error => {
    cacheReady = null
    throw error
  })
  return cacheReady
}

function cleanNumber(value = '') {
  return String(value || '').replace(/\D/g, '')
}

function cleanReason(value = '') {
  const reason = String(value || '').replace(/\s+/g, ' ').trim()
  return (reason || 'Sem motivo informado.').slice(0, 240)
}

function normalizeRecord(number, record = {}) {
  return {
    number: cleanNumber(number),
    jid: String(record.jid || ''),
    name: String(record.name || '').slice(0, 100),
    reason: cleanReason(record.reason),
    since: Number(record.since) > 0 ? Number(record.since) : Date.now()
  }
}

export async function setAfk(chat, number, record = {}) {
  const group = cleanNumber(chat)
  const user = cleanNumber(number)
  if (!group || !user) throw new Error('Chat ou usuário inválido para AFK.')
  await ensureCache()
  const next = await store.update(db => {
    db.groups ||= {}
    db.groups[group] ||= {}
    const value = normalizeRecord(user, record)
    db.groups[group][user] = value
    return { ...value }
  })
  if (!activeCache.has(group)) activeCache.set(group, new Map())
  activeCache.get(group).set(user, next)
  return { ...next }
}

export async function getAfk(chat, number) {
  const group = cleanNumber(chat)
  const user = cleanNumber(number)
  if (!group || !user) return null
  await ensureCache()
  const record = activeCache.get(group)?.get(user)
  return record ? { ...record } : null
}

export async function removeAfk(chat, number) {
  const group = cleanNumber(chat)
  const user = cleanNumber(number)
  if (!group || !user) return null
  await ensureCache()
  const cached = activeCache.get(group)?.get(user)
  if (!cached) return null
  const removed = await store.update(db => {
    const record = db.groups?.[group]?.[user]
    if (!record) return null
    delete db.groups[group][user]
    if (!Object.keys(db.groups[group]).length) delete db.groups[group]
    return normalizeRecord(user, record)
  })
  activeCache.get(group)?.delete(user)
  if (!activeCache.get(group)?.size) activeCache.delete(group)
  return removed ? { ...removed } : { ...cached }
}

export async function listAfk(chat) {
  const group = cleanNumber(chat)
  if (!group) return []
  await ensureCache()
  return [...(activeCache.get(group)?.values() || [])].map(record => ({ ...record }))
}

export function formatAfkDuration(since, now = Date.now()) {
  const milliseconds = Math.max(0, Number(now) - Number(since || now))
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 10) return 'alguns segundos'
  if (seconds < 60) return `${seconds} segundos`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours} hora${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days} dia${days === 1 ? '' : 's'}`
}

export function formatAfkClock(timestamp) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Recife',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(Number(timestamp)))
  } catch {
    return '-'
  }
}

export function buildAfkEnabledText(number, record) {
  return formatMessage([
    `@${number} agora está AFK.`,
    `Motivo: ${record.reason}`,
    `Desde: ${formatAfkClock(record.since)}`,
    'A Sakura avisará quem mencionar ou responder você.'
  ].join('\n'), { title: 'MODO AFK', brandFooter: true })
}

export function buildAfkReturnedText(number, record) {
  return formatMessage([
    `@${number} saiu do modo AFK.`,
    `Tempo ausente: ${formatAfkDuration(record.since)}`,
    `Motivo anterior: ${record.reason}`
  ].join('\n'), { title: 'BEM-VINDO(A) DE VOLTA', brandFooter: true })
}

export function buildAfkNoticeText(records = []) {
  const body = records.flatMap(record => [
    `@${record.number} está AFK há *${formatAfkDuration(record.since)}*.`,
    `Motivo: ${record.reason}`
  ])
  return formatMessage(body.join('\n'), { title: 'USUÁRIO AFK', brandFooter: true })
}
