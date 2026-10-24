import { createHash } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const RELEASE = '2.0.0-rc.11'
const SCHEMA_VERSION = 4
const CONFIG_CACHE_TTL_MS = 60_000
const configCache = new Map()

const DEFAULTS = Object.freeze({
  welcomeEnabled: false,
  welcomeMessage: 'Sejam bem-vindos ao grupo! Leiam as regras e aproveitem a conversa.',
  tiktokAutoEnabled: false,
  socialAutoEnabled: false,
  autoDownloadEnabled: settings.autoDownloadEnabledByDefault === true,
  dailyEnabled: false,
  dailyTime: '08:00',
  dailyTimezone: 'America/Recife',
  dailyMessage: 'Bom dia! A Sakura passou para acordar todo mundo. 🌸',
  dailyAudioPath: 'legacy/acorda.mp3',
  dailyLastLocalDate: '',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: 'America/Recife',
  antifloodEnabled: true,
  antifloodWindowMs: 10_000,
  antifloodUserLimit: 6,
  antifloodGroupLimit: 30,
  antifloodBaseBlockMs: 15_000,
  antifloodAdminMultiplier: 2,
  antifloodSubownerMultiplier: 4,
  updatedAt: 0
})

const store = openDatabase(settings.automationDb, {
  version: SCHEMA_VERSION,
  release: RELEASE,
  groups: {},
  floodUsers: {},
  floodGroups: {},
  tiktokSeen: {},
  socialSeen: {},
  autoDownloadSeen: {}
})

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback
}
const cleanText = (value, max = 500) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const cleanChat = value => cleanText(value, 180)
const cleanUser = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const clone = value => structuredClone(value)

function defaultConfig(chat = '') {
  return { chat: cleanChat(chat), ...clone(DEFAULTS) }
}

function normalizeConfig(row = {}, chat = '') {
  const base = defaultConfig(chat || row.chat)
  return {
    ...base,
    ...row,
    chat: cleanChat(row.chat || chat),
    welcomeEnabled: Boolean(row.welcomeEnabled),
    welcomeMessage: String(row.welcomeMessage || DEFAULTS.welcomeMessage),
    tiktokAutoEnabled: Boolean(row.tiktokAutoEnabled),
    socialAutoEnabled: Boolean(row.socialAutoEnabled),
    autoDownloadEnabled: Boolean(row.autoDownloadEnabled),
    dailyEnabled: Boolean(row.dailyEnabled),
    dailyTime: String(row.dailyTime || DEFAULTS.dailyTime),
    dailyTimezone: String(row.dailyTimezone || DEFAULTS.dailyTimezone),
    dailyMessage: String(row.dailyMessage || DEFAULTS.dailyMessage),
    dailyAudioPath: String(row.dailyAudioPath || DEFAULTS.dailyAudioPath),
    dailyLastLocalDate: String(row.dailyLastLocalDate || ''),
    quietHoursEnabled: Boolean(row.quietHoursEnabled),
    quietHoursStart: String(row.quietHoursStart || DEFAULTS.quietHoursStart),
    quietHoursEnd: String(row.quietHoursEnd || DEFAULTS.quietHoursEnd),
    quietHoursTimezone: String(row.quietHoursTimezone || DEFAULTS.quietHoursTimezone),
    antifloodEnabled: row.antifloodEnabled == null ? DEFAULTS.antifloodEnabled : Boolean(row.antifloodEnabled),
    antifloodWindowMs: Number(row.antifloodWindowMs || DEFAULTS.antifloodWindowMs),
    antifloodUserLimit: Number(row.antifloodUserLimit || DEFAULTS.antifloodUserLimit),
    antifloodGroupLimit: Number(row.antifloodGroupLimit || DEFAULTS.antifloodGroupLimit),
    antifloodBaseBlockMs: Number(row.antifloodBaseBlockMs || DEFAULTS.antifloodBaseBlockMs),
    antifloodAdminMultiplier: Number(row.antifloodAdminMultiplier || DEFAULTS.antifloodAdminMultiplier),
    antifloodSubownerMultiplier: Number(row.antifloodSubownerMultiplier || DEFAULTS.antifloodSubownerMultiplier),
    updatedAt: Number(row.updatedAt || 0)
  }
}

function ensureGroup(chat) {
  const key = cleanChat(chat)
  if (!key) throw new TypeError('Grupo inválido.')
  const current = store.readSync().groups?.[key]
  if (!current) {
    store.updateSync(db => {
      db.version = SCHEMA_VERSION
      db.release = RELEASE
      db.groups ||= {}
      if (!db.groups[key]) db.groups[key] = defaultConfig(key)
    })
  }
  return key
}

export function getAutomationConfig(chat) {
  const key = cleanChat(chat)
  const cached = configCache.get(key)
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) return clone(cached.value)
  ensureGroup(key)
  const value = normalizeConfig(store.readSync().groups?.[key], key)
  configCache.set(key, { value, cachedAt: Date.now() })
  return clone(value)
}

export function updateAutomationConfig(chat, patch = {}) {
  const current = getAutomationConfig(chat)
  const next = {
    ...current,
    welcomeEnabled: patch.welcomeEnabled == null ? current.welcomeEnabled : Boolean(patch.welcomeEnabled),
    welcomeMessage: patch.welcomeMessage == null ? current.welcomeMessage : cleanText(patch.welcomeMessage, 700) || DEFAULTS.welcomeMessage,
    tiktokAutoEnabled: patch.tiktokAutoEnabled == null ? current.tiktokAutoEnabled : Boolean(patch.tiktokAutoEnabled),
    socialAutoEnabled: patch.socialAutoEnabled == null ? current.socialAutoEnabled : Boolean(patch.socialAutoEnabled),
    autoDownloadEnabled: patch.autoDownloadEnabled == null ? current.autoDownloadEnabled : Boolean(patch.autoDownloadEnabled),
    dailyEnabled: patch.dailyEnabled == null ? current.dailyEnabled : Boolean(patch.dailyEnabled),
    dailyTime: patch.dailyTime == null ? current.dailyTime : String(patch.dailyTime),
    dailyTimezone: patch.dailyTimezone == null ? current.dailyTimezone : cleanText(patch.dailyTimezone, 80) || DEFAULTS.dailyTimezone,
    dailyMessage: patch.dailyMessage == null ? current.dailyMessage : cleanText(patch.dailyMessage, 900) || DEFAULTS.dailyMessage,
    dailyAudioPath: patch.dailyAudioPath == null ? current.dailyAudioPath : cleanText(patch.dailyAudioPath, 240),
    quietHoursEnabled: patch.quietHoursEnabled == null ? current.quietHoursEnabled : Boolean(patch.quietHoursEnabled),
    quietHoursStart: patch.quietHoursStart == null ? current.quietHoursStart : String(patch.quietHoursStart),
    quietHoursEnd: patch.quietHoursEnd == null ? current.quietHoursEnd : String(patch.quietHoursEnd),
    quietHoursTimezone: patch.quietHoursTimezone == null ? current.quietHoursTimezone : cleanText(patch.quietHoursTimezone, 80) || DEFAULTS.quietHoursTimezone,
    antifloodEnabled: patch.antifloodEnabled == null ? current.antifloodEnabled : Boolean(patch.antifloodEnabled),
    antifloodWindowMs: clamp(patch.antifloodWindowMs, 3_000, 120_000, current.antifloodWindowMs),
    antifloodUserLimit: clamp(patch.antifloodUserLimit, 2, 100, current.antifloodUserLimit),
    antifloodGroupLimit: clamp(patch.antifloodGroupLimit, 5, 500, current.antifloodGroupLimit),
    antifloodBaseBlockMs: clamp(patch.antifloodBaseBlockMs, 5_000, 30 * 60_000, current.antifloodBaseBlockMs),
    antifloodAdminMultiplier: clamp(patch.antifloodAdminMultiplier, 1, 10, current.antifloodAdminMultiplier),
    antifloodSubownerMultiplier: clamp(patch.antifloodSubownerMultiplier, 1, 20, current.antifloodSubownerMultiplier),
    updatedAt: Date.now()
  }
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!validTime(next.dailyTime) || !validTime(next.quietHoursStart) || !validTime(next.quietHoursEnd)) throw new TypeError('Horário inválido. Use HH:MM.')
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: next.dailyTimezone }).format(new Date())
    new Intl.DateTimeFormat('pt-BR', { timeZone: next.quietHoursTimezone }).format(new Date())
  } catch { throw new TypeError('Fuso horário inválido.') }
  store.updateSync(db => {
    db.groups ||= {}
    db.groups[current.chat] = next
  })
  configCache.delete(current.chat)
  return getAutomationConfig(current.chat)
}

function localTimeInZone(timeZone, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.hour}:${parts.minute}`
}

export function isQuietHoursActive(configOrChat, date = new Date()) {
  const config = typeof configOrChat === 'string' ? getAutomationConfig(configOrChat) : configOrChat
  if (!config?.quietHoursEnabled) return false
  const current = Number(localTimeInZone(config.quietHoursTimezone, date).replace(':', ''))
  const start = Number(String(config.quietHoursStart).replace(':', ''))
  const end = Number(String(config.quietHoursEnd).replace(':', ''))
  if (start === end) return true
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function listDailyAutomationGroups() {
  return Object.values(store.readSync().groups || {})
    .map(row => normalizeConfig(row, row.chat))
    .filter(row => row.dailyEnabled)
    .sort((a, b) => a.chat.localeCompare(b.chat))
}

export function claimDailyRun(chat, localDate) {
  const key = ensureGroup(chat)
  const date = cleanText(localDate, 20)
  let claimed = false
  store.updateSync(db => {
    db.groups ||= {}
    const row = normalizeConfig(db.groups[key], key)
    if (row.dailyEnabled && row.dailyLastLocalDate !== date) {
      row.dailyLastLocalDate = date
      row.updatedAt = Date.now()
      db.groups[key] = row
      claimed = true
    }
  })
  configCache.delete(key)
  return claimed
}

export function releaseDailyClaim(chat, localDate) {
  const key = cleanChat(chat)
  const date = cleanText(localDate, 20)
  store.updateSync(db => {
    const row = db.groups?.[key]
    if (row && row.dailyLastLocalDate === date) {
      row.dailyLastLocalDate = ''
      row.updatedAt = Date.now()
    }
  })
  configCache.delete(key)
}

function reserveUrl(bucketName, key, ttlMs, now = Date.now()) {
  let allowed = false
  store.updateSync(db => {
    db[bucketName] ||= {}
    const cutoff = now - Math.max(60_000, Number(ttlMs) || 0)
    for (const [itemKey, seenAt] of Object.entries(db[bucketName])) if (Number(seenAt) < cutoff) delete db[bucketName][itemKey]
    if (!db[bucketName][key]) {
      db[bucketName][key] = now
      allowed = true
    }
  })
  return allowed
}

export function reserveTikTokUrl(chat, url, ttlMs = 6 * 60 * 60_000) {
  const key = cleanChat(chat)
  const hash = createHash('sha256').update(String(url || '')).digest('hex')
  return reserveUrl('tiktokSeen', `${key}|${hash}`, ttlMs)
}

export function reserveSocialUrl(chat, platform, url, ttlMs = 6 * 60 * 60_000) {
  const key = cleanChat(chat)
  const cleanPlatform = cleanText(platform, 32).toLowerCase() || 'social'
  const hash = createHash('sha256').update(String(url || '')).digest('hex')
  return reserveUrl('socialSeen', `${key}|${cleanPlatform}|${hash}`, ttlMs)
}

export function reserveAutoDownloadUrl(chat, url, ttlMs = 6 * 60 * 60_000) {
  const key = cleanChat(chat)
  const hash = createHash('sha256').update(String(url || '')).digest('hex')
  return reserveUrl('autoDownloadSeen', `${key}|${hash}`, ttlMs)
}

function roleMultiplier(role, config) {
  if (role === 'owner') return Infinity
  if (role === 'subowner') return config.antifloodSubownerMultiplier
  if (role === 'admin') return config.antifloodAdminMultiplier
  return 1
}

export function checkCommandFlood({ chat, user, role = 'member', cost = 1, now = Date.now() } = {}) {
  const config = getAutomationConfig(chat)
  const userKey = cleanUser(user)
  if (!config.antifloodEnabled || role === 'owner' || !userKey) return { allowed: true, config }
  const multiplier = roleMultiplier(role, config)
  const userLimit = Math.max(1, Math.round(config.antifloodUserLimit * multiplier))
  const groupLimit = config.antifloodGroupLimit
  const safeCost = clamp(cost, 1, 10, 1)
  let result

  store.updateSync(db => {
    db.floodUsers ||= {}
    db.floodGroups ||= {}
    const userStateKey = `${config.chat}|${userKey}`
    const userState = { window_started_at: now, score: 0, violations: 0, blocked_until: 0, last_violation_at: 0, last_seen_at: now, ...(db.floodUsers[userStateKey] || {}) }
    const groupState = { window_started_at: now, score: 0, overloaded_until: 0, last_seen_at: now, ...(db.floodGroups[config.chat] || {}) }

    if (now - Number(userState.window_started_at || 0) >= config.antifloodWindowMs) { userState.window_started_at = now; userState.score = 0 }
    if (now - Number(groupState.window_started_at || 0) >= config.antifloodWindowMs) { groupState.window_started_at = now; groupState.score = 0; groupState.overloaded_until = 0 }
    if (now - Number(userState.last_violation_at || 0) > 24 * 60 * 60_000) userState.violations = 0

    if (Number(userState.blocked_until || 0) > now) {
      result = { allowed: false, blocked: true, warning: false, remainingMs: Number(userState.blocked_until) - now, reason: 'user', config }
    } else if (Number(groupState.overloaded_until || 0) > now && role === 'member') {
      result = { allowed: false, blocked: true, warning: false, remainingMs: Number(groupState.overloaded_until) - now, reason: 'group', config }
    } else {
      userState.score = Number(userState.score || 0) + safeCost
      groupState.score = Number(groupState.score || 0) + safeCost
      result = { allowed: true, config, score: userState.score, limit: userLimit }
      if (groupState.score > groupLimit && role === 'member') {
        groupState.overloaded_until = now + Math.min(20_000, Math.max(5_000, Math.round(config.antifloodBaseBlockMs / 2)))
        result = { allowed: false, blocked: true, warning: true, remainingMs: groupState.overloaded_until - now, reason: 'group', config }
      } else if (userState.score > userLimit) {
        userState.violations = Number(userState.violations || 0) + 1
        userState.last_violation_at = now
        if (userState.violations === 1) {
          userState.score = Math.max(0, userLimit - 1)
          result = { allowed: false, blocked: false, warning: true, remainingMs: 0, reason: 'user', config }
        } else {
          const blockMs = Math.min(60 * 60_000, config.antifloodBaseBlockMs * (2 ** Math.min(6, userState.violations - 2)))
          userState.blocked_until = now + blockMs
          result = { allowed: false, blocked: true, warning: true, remainingMs: blockMs, reason: 'user', config }
        }
      }
    }
    userState.last_seen_at = now
    groupState.last_seen_at = now
    db.floodUsers[userStateKey] = userState
    db.floodGroups[config.chat] = groupState
  })
  return result
}

export function clearFloodState(chat, user = '') {
  const key = cleanChat(chat)
  const userKey = cleanUser(user)
  let changes = 0
  store.updateSync(db => {
    db.floodUsers ||= {}
    db.floodGroups ||= {}
    if (userKey) {
      const stateKey = `${key}|${userKey}`
      if (db.floodUsers[stateKey]) { delete db.floodUsers[stateKey]; changes = 1 }
      return
    }
    for (const stateKey of Object.keys(db.floodUsers)) if (stateKey.startsWith(`${key}|`)) { delete db.floodUsers[stateKey]; changes += 1 }
    if (db.floodGroups[key]) { delete db.floodGroups[key]; changes += 1 }
  })
  return userKey ? changes : true
}

export function getAutomationStatus() {
  const db = store.readSync()
  const groups = Object.values(db.groups || {}).map(row => normalizeConfig(row, row.chat))
  const now = Date.now()
  return {
    release: RELEASE,
    schemaVersion: SCHEMA_VERSION,
    groups: groups.length,
    welcomes: groups.filter(row => row.welcomeEnabled).length,
    tiktok: groups.filter(row => row.tiktokAutoEnabled).length,
    social: groups.filter(row => row.socialAutoEnabled).length,
    daily: groups.filter(row => row.dailyEnabled).length,
    antiflood: groups.filter(row => row.antifloodEnabled).length,
    blocked: Object.values(db.floodUsers || {}).filter(row => Number(row.blocked_until || 0) > now).length
  }
}

export function closeAutomationStore() {
  configCache.clear()
}

export { DEFAULTS as AUTOMATION_DEFAULTS }
