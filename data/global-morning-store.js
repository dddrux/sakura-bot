import { openDatabase } from './database.js'
import { settings } from './settings.js'

const DEFAULT_MESSAGES = Object.freeze([
  'Que o dia de vocês comece leve, produtivo e cheio de boas conversas. 🌸',
  'Passando para desejar energia boa, paciência e muitos motivos para sorrir hoje. 🌸',
  'Acorda, grupo! Que hoje traga notícias boas e momentos ainda melhores. 💮',
  'Bom dia! Hidratem-se, cuidem de vocês e não esqueçam de espalhar gentileza. 🌸',
  'Mais um dia começou. Que não falte coragem para os desafios. 🌸',
  'Desejo uma manhã tranquila e um dia cheio de pequenas vitórias. 💮',
  'A Sakura veio abrir as janelas e desejar um dia incrível. 🌸',
  'Que o grupo acorde com paz, bom humor e boas conversas. 🌸'
])

const defaults = {
  version: 2,
  config: { enabled: false, time: '09:00', timezone: 'America/Recife', audioPath: 'legacy/acorda.mp3', messages: [...DEFAULT_MESSAGES], lastLocalDate: '', updatedAt: 0 },
  groups: {}
}
const store = openDatabase(settings.globalMorningDb, defaults)
const cleanText = (value, max = 900) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const cleanChat = value => cleanText(value, 180)

function validateTime(value) {
  const text = String(value || '')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new TypeError('Horário inválido. Use HH:MM.')
  return text
}

function validateTimezone(value) {
  const text = cleanText(value, 80)
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: text }).format(new Date()) } catch { throw new TypeError('Fuso horário inválido.') }
  return text
}

function normalizedConfig(raw = {}) {
  const messages = Array.isArray(raw.messages) ? raw.messages.map(value => cleanText(value, 900)).filter(value => value.length >= 5).slice(0, 30) : []
  return {
    enabled: Boolean(raw.enabled),
    time: String(raw.time || '09:00'),
    timezone: String(raw.timezone || 'America/Recife'),
    audioPath: String(raw.audioPath || 'legacy/acorda.mp3'),
    messages: messages.length ? messages : [...DEFAULT_MESSAGES],
    lastLocalDate: String(raw.lastLocalDate || ''),
    updatedAt: Number(raw.updatedAt) || 0
  }
}

export function getGlobalMorningConfig() {
  return normalizedConfig(store.readSync().config)
}

export function updateGlobalMorningConfig(patch = {}) {
  const current = getGlobalMorningConfig()
  const next = {
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    time: patch.time == null ? current.time : validateTime(patch.time),
    timezone: patch.timezone == null ? current.timezone : validateTimezone(patch.timezone),
    audioPath: patch.audioPath == null ? current.audioPath : cleanText(patch.audioPath, 240),
    messages: patch.messages == null ? current.messages : (Array.isArray(patch.messages) ? patch.messages.map(value => cleanText(value, 900)).filter(value => value.length >= 5).slice(0, 30) : current.messages),
    lastLocalDate: current.lastLocalDate,
    updatedAt: Date.now()
  }
  if (!next.messages.length) next.messages = [...DEFAULT_MESSAGES]
  store.updateSync(db => { db.version = 2; db.config = next; db.groups ||= {} })
  return getGlobalMorningConfig()
}

export function claimGlobalMorning(localDate = '') {
  const date = cleanText(localDate, 20)
  let claimed = false
  store.updateSync(db => {
    db.config = normalizedConfig(db.config)
    if (db.config.enabled && db.config.lastLocalDate !== date) {
      db.config.lastLocalDate = date
      db.config.updatedAt = Date.now()
      claimed = true
    }
  })
  return claimed
}

export function releaseGlobalMorningClaim(localDate = '') {
  const date = cleanText(localDate, 20)
  store.updateSync(db => {
    db.config = normalizedConfig(db.config)
    if (db.config.lastLocalDate === date) {
      db.config.lastLocalDate = ''
      db.config.updatedAt = Date.now()
    }
  })
}

export function isGlobalMorningDisabledForGroup(chat = '') {
  const key = cleanChat(chat)
  if (!key) return false
  return Boolean(store.readSync().groups?.[key]?.disabled)
}

export function setGlobalMorningGroupDisabled(chat = '', disabled = true) {
  const key = cleanChat(chat)
  if (!key.endsWith('@g.us')) throw new TypeError('Grupo inválido.')
  store.updateSync(db => {
    db.groups ||= {}
    db.groups[key] = { disabled: Boolean(disabled), updatedAt: Date.now() }
  })
  return Boolean(disabled)
}

export function globalMorningStoreStatus() {
  const db = store.readSync()
  const excludedGroups = Object.values(db.groups || {}).filter(row => row.disabled).length
  return { dbPath: settings.databaseFile, config: getGlobalMorningConfig(), excludedGroups, integrity: 'json' }
}

export function closeGlobalMorningStore() {}
export { DEFAULT_MESSAGES as GLOBAL_MORNING_DEFAULT_MESSAGES }
