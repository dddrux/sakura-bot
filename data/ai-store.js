import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { isPlausibleAiToken } from './ai-token-utils.js'

const SCHEMA_VERSION = 3
const RELEASE = '2.0.0-rc.11'
const cleanText = (value, max = 200) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const clamp = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
const dateKey = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Recife' })
const clone = value => structuredClone(value)

const defaultGlobal = () => ({
  globalEnabled: settings.aiEnabled !== false,
  privateEnabled: true,
  model: settings.aiModel,
  systemPrompt: '',
  maxContextMessages: 6,
  maxContextChars: 3500,
  timeoutMs: 12000,
  maxOutputTokens: 320,
  temperature: 0.8,
  updatedAt: 0
})
const defaultGroup = chat => ({
  chat,
  enabled: false,
  mode: 'mention',
  cooldownMs: 15000,
  dailyLimit: 50,
  dailyDate: '',
  dailyUsed: 0,
  lastResponseAt: 0,
  updatedAt: 0
})
const store = openDatabase(settings.aiDb, {
  version: SCHEMA_VERSION,
  release: RELEASE,
  global: defaultGlobal(),
  groups: {}
})

function normalizeGlobal(row = {}) {
  const base = defaultGlobal()
  return {
    ...base,
    ...row,
    globalEnabled: Boolean(row.globalEnabled),
    privateEnabled: row.privateEnabled == null ? true : Boolean(row.privateEnabled),
    model: row.model || settings.aiModel,
    systemPrompt: row.systemPrompt || '',
    maxContextMessages: Number(row.maxContextMessages) || 6,
    maxContextChars: Number(row.maxContextChars) || 3500,
    timeoutMs: Number(row.timeoutMs) || 12000,
    maxOutputTokens: Number(row.maxOutputTokens) || 320,
    temperature: Number(row.temperature) || 0.8,
    updatedAt: Number(row.updatedAt) || 0
  }
}

function normalizeGroup(row = {}, chat = '') {
  const base = defaultGroup(chat || row.chat || '')
  return {
    ...base,
    ...row,
    chat: row.chat || chat,
    enabled: Boolean(row.enabled),
    mode: row.mode === 'all' ? 'all' : 'mention',
    cooldownMs: Number(row.cooldownMs) || 15000,
    dailyLimit: Number(row.dailyLimit) || 50,
    dailyDate: row.dailyDate || '',
    dailyUsed: row.dailyDate === dateKey() ? (Number(row.dailyUsed) || 0) : 0,
    lastResponseAt: Number(row.lastResponseAt) || 0,
    updatedAt: Number(row.updatedAt) || 0
  }
}

export function getAiGlobalConfig() {
  return normalizeGlobal(store.readSync().global)
}

export function updateAiGlobalConfig(values = {}) {
  const current = getAiGlobalConfig()
  const next = {
    globalEnabled: values.globalEnabled == null ? current.globalEnabled : Boolean(values.globalEnabled),
    privateEnabled: values.privateEnabled == null ? current.privateEnabled : Boolean(values.privateEnabled),
    model: cleanText(values.model ?? current.model, 120) || settings.aiModel,
    systemPrompt: values.systemPrompt == null ? current.systemPrompt : cleanText(values.systemPrompt, 8000),
    maxContextMessages: Math.floor(clamp(values.maxContextMessages ?? current.maxContextMessages, 1, 12, 6)),
    maxContextChars: Math.floor(clamp(values.maxContextChars ?? current.maxContextChars, 500, 8000, 3500)),
    timeoutMs: Math.floor(clamp(values.timeoutMs ?? current.timeoutMs, 4000, 30000, 12000)),
    maxOutputTokens: Math.floor(clamp(values.maxOutputTokens ?? current.maxOutputTokens, 64, 1000, 320)),
    temperature: clamp(values.temperature ?? current.temperature, 0.1, 2, 0.8),
    updatedAt: Date.now()
  }
  store.updateSync(db => { db.version = SCHEMA_VERSION; db.release = RELEASE; db.global = next })
  return clone(next)
}

export function getAiGroupConfig(chat = '') {
  const key = cleanText(chat, 180)
  return normalizeGroup(store.readSync().groups?.[key], key)
}

export function updateAiGroupConfig(chat = '', values = {}) {
  const key = cleanText(chat, 180)
  if (!key) throw new TypeError('Grupo inválido.')
  const current = getAiGroupConfig(key)
  const next = {
    ...current,
    enabled: values.enabled == null ? current.enabled : Boolean(values.enabled),
    mode: values.mode == null ? current.mode : (values.mode === 'all' ? 'all' : 'mention'),
    cooldownMs: Math.floor(clamp(values.cooldownMs ?? current.cooldownMs, 3000, 10 * 60_000, 15000)),
    dailyLimit: Math.floor(clamp(values.dailyLimit ?? current.dailyLimit, 1, 500, 50)),
    updatedAt: Date.now()
  }
  store.updateSync(db => { db.groups ||= {}; db.groups[key] = next })
  return getAiGroupConfig(key)
}

export function reserveAiRequest(chat = '', { cooldownMs = 15000, dailyLimit = 50, now = Date.now() } = {}) {
  const key = cleanText(chat, 180)
  const today = dateKey(now)
  let result
  store.updateSync(db => {
    db.groups ||= {}
    const row = { ...defaultGroup(key), ...(db.groups[key] || {}) }
    const used = row.dailyDate === today ? Number(row.dailyUsed) || 0 : 0
    if (row.lastResponseAt && now - Number(row.lastResponseAt) < cooldownMs) {
      result = { allowed: false, reason: 'cooldown', remainingMs: cooldownMs - (now - Number(row.lastResponseAt)), used, limit: dailyLimit }
      return
    }
    if (used >= dailyLimit) {
      result = { allowed: false, reason: 'daily-limit', remainingMs: 0, used, limit: dailyLimit }
      return
    }
    row.dailyDate = today
    row.dailyUsed = used + 1
    row.lastResponseAt = now
    row.cooldownMs = cooldownMs
    row.dailyLimit = dailyLimit
    row.updatedAt = now
    db.groups[key] = row
    result = { allowed: true, reason: 'ok', remainingMs: 0, used: used + 1, limit: dailyLimit, reservedAt: now, date: today }
  })
  return result
}

export function releaseAiRequest(chat = '', reservation = {}) {
  const key = cleanText(chat, 180)
  if (!key || !reservation?.allowed) return false
  let changed = false
  store.updateSync(db => {
    const row = db.groups?.[key]
    if (!row || row.dailyDate !== reservation.date) return
    row.dailyUsed = Math.max(0, Number(row.dailyUsed || 0) - 1)
    if (Number(row.lastResponseAt || 0) === Number(reservation.reservedAt || 0)) row.lastResponseAt = 0
    row.updatedAt = Date.now()
    changed = true
  })
  return changed
}

export function getAiPoolStatus() {
  const rows = (Array.isArray(settings.aiTokens) ? settings.aiTokens : [])
    .map((entry, index) => typeof entry === 'object' && entry ? entry : { token: entry, label: `Config ${index + 1}` })
  return {
    total: rows.length,
    active: rows.filter(row => row.enabled !== false && isPlausibleAiToken(row.token || row.value)).length,
    ready: rows.filter(row => row.enabled !== false && isPlausibleAiToken(row.token || row.value)).length,
    cooling: 0,
    invalid: rows.filter(row => !isPlausibleAiToken(row.token || row.value)).length
  }
}

export function getAiStoreStatus() {
  const db = store.readSync()
  return {
    release: RELEASE,
    schemaVersion: SCHEMA_VERSION,
    global: getAiGlobalConfig(),
    pool: getAiPoolStatus(),
    groups: Object.values(db.groups || {}).filter(row => row.enabled).length,
    integrity: 'json'
  }
}

export function closeAiStore() {}
