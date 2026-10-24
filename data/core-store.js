import { randomUUID } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const SCHEMA_VERSION = 14
const RELEASE = '2.0.0-beta.1'
const store = openDatabase(settings.coreDb, {
  version: SCHEMA_VERSION,
  release: RELEASE,
  subowners: {},
  audit: [],
  users: {},
  moduleVersions: {}
})
let initialized = false

const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const cleanText = (value, max = 160) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const clone = value => structuredClone(value)

function safeDetails(value = {}) {
  const result = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (/token|secret|session|cookie|password|senha|chave/i.test(key)) {
      result[key] = '[protegido]'
      continue
    }
    if (typeof item === 'number' || typeof item === 'boolean' || item == null) result[key] = item
    else result[key] = cleanText(item, 300)
  }
  return result
}

export function initializeCoreStore() {
  if (!initialized) {
    store.updateSync(db => {
      db.version = SCHEMA_VERSION
      db.release = RELEASE
      db.subowners ||= {}
      db.audit ||= []
      db.users ||= {}
      db.moduleVersions ||= {}
    })
    initialized = true
  }
  return { ...getCoreStatus(), backupPath: null }
}

function ready() {
  if (!initialized) initializeCoreStore()
  return store
}

export function writeAudit({ actor = '', action = '', target = '', chat = '', details = {} } = {}) {
  const row = {
    id: randomUUID(),
    createdAt: Date.now(),
    actor: digits(actor),
    action: cleanText(action, 100),
    target: cleanText(target, 180),
    chat: cleanText(chat, 180),
    details: safeDetails(details)
  }
  ready().updateSync(db => {
    db.audit ||= []
    db.audit.unshift(row)
    if (db.audit.length > 5000) db.audit.length = 5000
  })
  return clone(row)
}

export function isSubowner(number) {
  const key = digits(number)
  if (!key) return false
  return Boolean(ready().readSync().subowners?.[key]?.active)
}

export function addSubowner(number, actor = '') {
  const key = digits(number)
  const owner = digits(settings.ownerNumber)
  if (key.length < 10) throw new TypeError('Número inválido para subdono.')
  if (key === owner) throw new TypeError('O dono principal já possui todas as permissões.')
  const at = Date.now()
  const addedBy = digits(actor)
  ready().updateSync(db => {
    db.subowners ||= {}
    db.subowners[key] = { number: key, active: true, addedBy, addedAt: at, removedAt: null }
  })
  writeAudit({ actor, action: 'subowner.add', target: key })
  return { number: key, active: true, addedBy, addedAt: at }
}

export function removeSubowner(number, actor = '') {
  const key = digits(number)
  if (!key) return false
  let changed = false
  ready().updateSync(db => {
    const row = db.subowners?.[key]
    if (row?.active) {
      row.active = false
      row.removedAt = Date.now()
      changed = true
    }
  })
  if (changed) writeAudit({ actor, action: 'subowner.remove', target: key })
  return changed
}

export function listSubowners() {
  return Object.values(ready().readSync().subowners || {})
    .filter(row => row.active)
    .sort((a, b) => Number(a.addedAt) - Number(b.addedAt))
    .map(row => ({ number: row.number, addedBy: row.addedBy || '', addedAt: Number(row.addedAt) || 0 }))
}

export function listAudit(limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)))
  return (ready().readSync().audit || []).slice(0, safeLimit).map(row => clone(row))
}

export function rememberUser({ number = '', jid = '', mentionJid = '', phoneJid = '', lidJid = '', name = '', source = 'message' } = {}) {
  const key = digits(number || phoneJid || jid || mentionJid || lidJid)
  if (!key) return null
  const cleanName = cleanText(name, 80)
  const cleanPhoneJid = cleanText(phoneJid || (String(jid).includes('@s.whatsapp.net') ? jid : '') || `${key}@s.whatsapp.net`, 180)
  const cleanLidJid = cleanText(lidJid || (String(jid).includes('@lid') ? jid : '') || (String(mentionJid).includes('@lid') ? mentionJid : ''), 180)
  const cleanMentionJid = cleanText(cleanPhoneJid || mentionJid || cleanLidJid || jid, 180)
  const cleanJid = cleanText(jid || cleanMentionJid || cleanPhoneJid, 180)
  const seenAt = Date.now()
  let saved
  ready().updateSync(db => {
    db.users ||= {}
    const old = db.users[key] || {}
    saved = {
      number: key,
      jid: cleanJid || old.jid || '',
      mentionJid: cleanMentionJid || old.mentionJid || '',
      phoneJid: cleanPhoneJid || old.phoneJid || '',
      lidJid: cleanLidJid || old.lidJid || '',
      name: cleanName || old.name || '',
      source: cleanText(source, 30) || 'message',
      lastSeenAt: seenAt
    }
    db.users[key] = saved
  })
  return clone(saved)
}

export function getRememberedUser(number) {
  const key = digits(number)
  if (!key) return null
  const row = ready().readSync().users?.[key]
  return row ? clone(row) : null
}

export function getRememberedUserByIdentity(value) {
  const raw = cleanText(value, 180)
  const key = digits(raw)
  if (!raw && !key) return null
  const rows = Object.values(ready().readSync().users || {})
  const lower = raw.toLowerCase()
  const matches = rows.filter(row => {
    if (key && row.number === key) return true
    for (const candidate of [row.jid, row.mentionJid, row.phoneJid, row.lidJid]) {
      const text = String(candidate || '')
      if (!text) continue
      if (text.toLowerCase() === lower) return true
      if (key && digits(text) === key) return true
    }
    return false
  }).sort((a, b) => (a.number === key ? -1 : 0) - (b.number === key ? -1 : 0) || Number(b.lastSeenAt) - Number(a.lastSeenAt))
  return matches[0] ? clone(matches[0]) : null
}

export function getRememberedUsers(numbers = []) {
  const output = new Map()
  for (const number of numbers) {
    const row = getRememberedUser(number)
    if (row) output.set(row.number, row)
  }
  return output
}

export function getCoreStatus() {
  const db = store.readSync()
  return {
    release: RELEASE,
    schemaVersion: Number(db.version || SCHEMA_VERSION),
    expectedSchemaVersion: SCHEMA_VERSION,
    subowners: Object.values(db.subowners || {}).filter(row => row.active).length,
    users: Object.keys(db.users || {}).length,
    integrity: 'json'
  }
}

export function closeCoreStore() {
  initialized = false
}
