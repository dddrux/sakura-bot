import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mirrorFileToBackup } from './persistent-mirror.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clone = value => structuredClone(value)
const stores = new Map()
let state = null
let writeQueue = Promise.resolve()
let dirty = false
let flushTimer = null
let databaseFile = ''

function configuredDatabaseFile() {
  return path.resolve(process.env.SAKURA_DB_FILE || path.join(rootDir, 'storage', 'sakura-db.json'))
}

function emptyState() {
  return { schemaVersion: 2, updatedAt: Date.now(), namespaces: {} }
}

function loadState() {
  const target = configuredDatabaseFile()
  if (state && databaseFile === target) return state
  databaseFile = target
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true })
  try {
    const parsed = JSON.parse(fs.readFileSync(databaseFile, 'utf8'))
    state = parsed && typeof parsed === 'object' ? parsed : emptyState()
  } catch {
    state = emptyState()
  }
  if (!state.namespaces || typeof state.namespaces !== 'object' || Array.isArray(state.namespaces)) state.namespaces = {}
  state.schemaVersion = 2
  return state
}

function namespaceFrom(input = '') {
  const raw = String(input || 'main').trim()
  if (!raw) return 'main'
  const base = path.basename(raw).replace(/\.(db|sqlite|json)$/i, '')
  return base || 'main'
}

function scheduleFlush() {
  dirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDatabase()
  }, 20)
  flushTimer.unref?.()
}

async function atomicWrite(snapshot) {
  const target = configuredDatabaseFile()
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  await fsp.rename(temp, target)
  try { await mirrorFileToBackup(target, 'storage/sakura-db.json', { rootDir: path.resolve(path.dirname(target), '..') }) } catch {}
}

export async function flushDatabase() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!dirty) return false
  dirty = false
  const snapshot = clone(loadState())
  snapshot.updatedAt = Date.now()
  writeQueue = writeQueue.then(() => atomicWrite(snapshot)).catch(error => {
    dirty = true
    throw error
  })
  await writeQueue
  return true
}

export class JsonDocumentDatabase {
  constructor(namespace, defaults = {}) {
    this.namespace = namespaceFrom(namespace)
    this.defaults = clone(defaults)
    this.queue = Promise.resolve()
    const db = loadState()
    if (!Object.hasOwn(db.namespaces, this.namespace)) {
      db.namespaces[this.namespace] = clone(this.defaults)
      scheduleFlush()
    }
  }

  async load() { return this.read() }
  readSync() {
    const db = loadState()
    const raw = db.namespaces[this.namespace]
    if (!raw || typeof raw !== 'object') return clone(this.defaults)
    return { ...clone(this.defaults), ...clone(raw) }
  }

  async read() {
    const db = loadState()
    const raw = db.namespaces[this.namespace]
    if (!raw || typeof raw !== 'object') return clone(this.defaults)
    return { ...clone(this.defaults), ...clone(raw) }
  }

  updateSync(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('updateSync requer uma função mutadora.')
    const db = loadState()
    const current = db.namespaces[this.namespace]
    const draft = { ...clone(this.defaults), ...(current && typeof current === 'object' ? clone(current) : {}) }
    const result = mutator(draft)
    if (result && typeof result.then === 'function') throw new TypeError('updateSync não aceita mutadores assíncronos.')
    db.namespaces[this.namespace] = draft
    db.updatedAt = Date.now()
    scheduleFlush()
    return result
  }

  replaceSync(next) {
    return this.updateSync(draft => {
      for (const key of Object.keys(draft)) delete draft[key]
      Object.assign(draft, clone(next))
    })
  }

  async update(mutator) {
    const task = this.queue.then(async () => {
      const db = loadState()
      const current = db.namespaces[this.namespace]
      const draft = { ...clone(this.defaults), ...(current && typeof current === 'object' ? clone(current) : {}) }
      const result = await mutator(draft)
      db.namespaces[this.namespace] = draft
      db.updatedAt = Date.now()
      scheduleFlush()
      return result
    })
    this.queue = task.catch(() => {})
    return task
  }

  async replace(next) {
    return this.update(draft => {
      for (const key of Object.keys(draft)) delete draft[key]
      Object.assign(draft, clone(next))
    })
  }

  close() {}
}

export function openDatabase(namespaceOrLegacyPath, defaults = {}) {
  const namespace = namespaceFrom(namespaceOrLegacyPath)
  if (!stores.has(namespace)) stores.set(namespace, new JsonDocumentDatabase(namespace, defaults))
  return stores.get(namespace)
}

export function databaseStatus() {
  const db = loadState()
  return { file: configuredDatabaseFile(), namespaces: Object.keys(db.namespaces).sort(), dirty, cachedStores: stores.size, updatedAt: db.updatedAt || 0 }
}

export function closeAllDatabases() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  stores.clear()
  state = null
  databaseFile = ''
}

export async function removeLegacyFiles(directory) {
  const entries = await fsp.readdir(directory).catch(() => [])
  await Promise.all(entries.filter(name => /\.(?:db|sqlite|legacy)(?:-(?:wal|shm))?$/i.test(name)).map(name => fsp.rm(path.join(directory, name), { force: true })))
}
