import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { stripStickerMetadata } from './sticker-metadata.js'

const MAX_LIBRARY = 600
const store = openDatabase(settings.stickerLibraryDb, {
  version: 1,
  enabled: false,
  entries: {},
  order: [],
  stats: { saved: 0, duplicates: 0, missing: 0 }
})

function safeText(value = '', limit = 80) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function hashSticker(buffer) {
  let visual = buffer
  try { visual = stripStickerMetadata(buffer) } catch {}
  return createHash('sha256').update(visual).digest('hex')
}

function fileFor(hash) {
  return path.join(settings.stickerLibraryDir, `${hash}.webp`)
}

async function ensureDirectory() {
  await fs.mkdir(settings.stickerLibraryDir, { recursive: true })
}

export async function setStickerLibraryEnabled(enabled, actor = '') {
  return store.update(db => {
    db.version = 1
    db.enabled = Boolean(enabled)
    db.updatedAt = Date.now()
    db.updatedBy = safeText(actor, 40)
    return { enabled: db.enabled, updatedAt: db.updatedAt }
  })
}

export async function stickerLibraryStatus() {
  const db = await store.read()
  return {
    enabled: Boolean(db.enabled),
    count: Object.keys(db.entries || {}).length,
    max: MAX_LIBRARY,
    saved: Number(db.stats?.saved || 0),
    duplicates: Number(db.stats?.duplicates || 0),
    missing: Number(db.stats?.missing || 0)
  }
}

export async function saveStickerToLibrary(buffer, metadata = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return { saved: false, reason: 'invalid' }
  const current = await store.read()
  if (!current.enabled) return { saved: false, reason: 'disabled' }
  const hash = hashSticker(buffer)
  await ensureDirectory()
  const target = fileFor(hash)
  let evicted = []
  const result = await store.update(async db => {
    db.entries ||= {}
    db.order ||= []
    db.stats ||= { saved: 0, duplicates: 0, missing: 0 }
    if (!db.enabled) return { saved: false, reason: 'disabled', hash }
    if (db.entries[hash]) {
      db.entries[hash].lastSeenAt = Date.now()
      db.entries[hash].uses = Number(db.entries[hash].uses || 0) + 1
      db.stats.duplicates = Number(db.stats.duplicates || 0) + 1
      return { saved: false, duplicate: true, hash, file: target }
    }
    await fs.writeFile(target, buffer)
    db.entries[hash] = {
      hash,
      file: `${hash}.webp`,
      source: safeText(metadata.source || 'generated', 40),
      creator: safeText(metadata.creator || '', 32),
      chat: safeText(metadata.chat || '', 40),
      animated: Boolean(metadata.animated),
      bytes: buffer.length,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      uses: 1
    }
    db.order = [...db.order.filter(item => item !== hash), hash]
    db.stats.saved = Number(db.stats.saved || 0) + 1
    while (db.order.length > MAX_LIBRARY) {
      const old = db.order.shift()
      if (!old || old === hash) continue
      const row = db.entries[old]
      delete db.entries[old]
      if (row?.file) evicted.push(path.join(settings.stickerLibraryDir, path.basename(row.file)))
    }
    return { saved: true, hash, file: target }
  })
  await Promise.all(evicted.map(file => fs.rm(file, { force: true }).catch(() => {})))
  return result
}

function normalizeChat(value = '') {
  const raw = safeText(value, 180).toLowerCase()
  const digits = raw.split('@')[0].split(':')[0].replace(/\D/g, '')
  return digits || raw
}

export async function getRandomSticker(options = {}) {
  await ensureDirectory()
  const requestedChat = normalizeChat(options.chat)
  const excludeHashes = new Set(Array.from(options.excludeHashes || []).map(String))
  const allowCrossChat = options.allowCrossChat !== false

  for (let attempts = 0; attempts < 8; attempts += 1) {
    const db = await store.read()
    const entries = Object.entries(db.entries || {})
    if (!entries.length) return null

    let candidates = entries
    if (requestedChat) {
      const local = entries.filter(([, row]) => normalizeChat(row?.chat) === requestedChat)
      const neutral = entries.filter(([, row]) => !normalizeChat(row?.chat))
      candidates = local.length ? local : neutral.length ? neutral : (allowCrossChat ? entries : [])
    }
    if (!candidates.length) return null

    const fresh = candidates.filter(([hash]) => !excludeHashes.has(hash))
    if (fresh.length) candidates = fresh
    const [hash, row] = candidates[Math.floor(Math.random() * candidates.length)]
    const file = fileFor(hash)
    try {
      const buffer = await fs.readFile(file)
      await store.update(draft => {
        if (draft.entries?.[hash]) {
          draft.entries[hash].draws = Number(draft.entries[hash].draws || 0) + 1
          draft.entries[hash].lastDrawAt = Date.now()
        }
      })
      return { hash, row, buffer }
    } catch {
      await store.update(draft => {
        if (draft.entries?.[hash]) delete draft.entries[hash]
        draft.order = (draft.order || []).filter(item => item !== hash)
        draft.stats ||= {}
        draft.stats.missing = Number(draft.stats.missing || 0) + 1
      })
    }
  }
  return null
}

export async function pruneMissingStickers() {
  const db = await store.read()
  const missing = []
  for (const [hash, row] of Object.entries(db.entries || {})) {
    try { await fs.access(fileFor(hash)) } catch { missing.push({ hash, row }) }
  }
  if (!missing.length) return 0
  await store.update(draft => {
    for (const item of missing) delete draft.entries[item.hash]
    draft.order = (draft.order || []).filter(hash => !missing.some(item => item.hash === hash))
    draft.stats ||= {}
    draft.stats.missing = Number(draft.stats.missing || 0) + missing.length
  })
  return missing.length
}

export async function clearStickerLibrary() {
  await ensureDirectory()
  const files = await fs.readdir(settings.stickerLibraryDir).catch(() => [])
  const stickers = files.filter(name => name.endsWith('.webp'))
  await Promise.all(stickers.map(name => fs.rm(path.join(settings.stickerLibraryDir, name), { force: true })))
  await store.update(db => {
    db.entries = {}
    db.order = []
    db.stats = { saved: 0, duplicates: 0, missing: 0 }
    db.updatedAt = Date.now()
  })
  return stickers.length
}
