import { openDatabase } from './database.js'
import { settings } from './settings.js'

const CACHE_TTL_MS = 60_000
const cache = new Map()
const store = openDatabase(settings.protectionDb, { version: 2, groups: {} })

function cleanChat(chat = '') {
  const value = String(chat || '').trim()
  if (!value.endsWith('@g.us')) throw new TypeError('Grupo inválido para proteção.')
  return value
}

export function getProtectionConfig(chat) {
  const key = cleanChat(chat)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value }
  const db = store.readSync()
  const row = db.groups?.[key] || {}
  const value = { chat: key, antilinkEnabled: Boolean(row.antilinkEnabled) }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return { ...value }
}

export function updateProtectionConfig(chat, patch = {}) {
  const current = getProtectionConfig(chat)
  const next = {
    ...current,
    antilinkEnabled: patch.antilinkEnabled == null ? current.antilinkEnabled : Boolean(patch.antilinkEnabled),
    updatedAt: Date.now()
  }
  store.updateSync(db => {
    db.version = 2
    db.groups ||= {}
    db.groups[next.chat] = { antilinkEnabled: next.antilinkEnabled, updatedAt: next.updatedAt }
  })
  const value = { chat: next.chat, antilinkEnabled: next.antilinkEnabled }
  cache.set(next.chat, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return { ...value }
}

export function closeProtectionStore() {
  cache.clear()
}
