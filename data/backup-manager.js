import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const BACKUP_FORMAT = 'sakura-persistent-backup-v2'
const SUPPORTED_BACKUP_FORMATS = new Set(['sakura-persistent-backup-v1', BACKUP_FORMAT])
const DEFAULT_INTERVAL_MS = 60_000
const FILES = ['.env', 'config/sakura.config.json', 'config/ai-personality.txt', 'storage/sakura-db.json']
const DIRECTORIES = ['config/private', 'auth', 'storage/sticker-library', 'storage/command-media', 'storage/automation-media', 'storage/action-media']
const EXCLUDED_BASENAMES = new Set(['.process.lock'])
let scheduler = null
let activeSnapshot = null

function normalizeRelative(relative = '') {
  const value = String(relative || '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!value || value.includes('../') || path.isAbsolute(value)) throw new Error(`Caminho de backup inválido: ${relative}`)
  return value
}

async function exists(target) {
  try { await fsp.access(target); return true } catch { return false }
}

async function statOrNull(target) {
  try { return await fsp.stat(target) } catch { return null }
}

async function directoryHasFiles(target) {
  const stat = await statOrNull(target)
  if (!stat?.isDirectory()) return false
  for (const entry of await fsp.readdir(target, { withFileTypes: true })) {
    if (EXCLUDED_BASENAMES.has(entry.name)) continue
    const child = path.join(target, entry.name)
    if (entry.isFile()) return true
    if (entry.isDirectory() && await directoryHasFiles(child)) return true
  }
  return false
}

async function discoverBackupManifest(backupRoot) {
  const entries = []
  let newest = 0
  for (const relative of FILES) {
    const safe = normalizeRelative(relative)
    const target = path.join(backupRoot, safe)
    const stat = await statOrNull(target)
    if (!stat?.isFile()) continue
    entries.push(safe)
    newest = Math.max(newest, Number(stat.mtimeMs) || 0)
  }
  for (const relative of DIRECTORIES) {
    const safe = normalizeRelative(relative)
    const target = path.join(backupRoot, safe)
    if (!(await directoryHasFiles(target))) continue
    entries.push(`${safe}/`)
    const stat = await statOrNull(target)
    newest = Math.max(newest, Number(stat?.mtimeMs) || 0)
  }
  if (!entries.length) return null
  return {
    format: 'sakura-persistent-backup-discovered',
    updatedAt: new Date(newest || Date.now()).toISOString(),
    entries,
    policy: 'B',
    excludes: ['auth/.process.lock'],
    discovered: true
  }
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return structuredClone(override)
  if (!override || typeof override !== 'object') return structuredClone(override)
  const out = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {}
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = deepMerge(out[key], value)
    else out[key] = structuredClone(value)
  }
  return out
}

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, data, { mode: 0o600 })
  await fsp.rename(temp, file)
}

async function copyFileAtomic(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temp = `${destination}.${process.pid}.${Date.now()}.tmp`
  await fsp.copyFile(source, temp)
  await fsp.rename(temp, destination)
}

async function copyDirectory(source, destination, { replace = false, newerOnly = false } = {}) {
  const sourceStat = await statOrNull(source)
  if (!sourceStat?.isDirectory()) return 0
  if (replace) await fsp.rm(destination, { recursive: true, force: true })
  await fsp.mkdir(destination, { recursive: true })
  let copied = 0
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    if (EXCLUDED_BASENAMES.has(entry.name)) continue
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copied += await copyDirectory(from, to, { replace: false, newerOnly })
      continue
    }
    if (!entry.isFile()) continue
    if (newerOnly) {
      const [fromStat, toStat] = await Promise.all([statOrNull(from), statOrNull(to)])
      if (toStat && fromStat && toStat.mtimeMs > fromStat.mtimeMs) continue
    }
    await copyFileAtomic(from, to)
    copied += 1
  }
  return copied
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch { return null }
}

function hasDatabaseContent(value) {
  return Boolean(value && typeof value === 'object' && value.namespaces && Object.keys(value.namespaces).length)
}

async function restoreDatabase(backupFile, runtimeFile) {
  if (!(await exists(backupFile))) return false
  const backupJson = await readJson(backupFile)
  if (!backupJson || typeof backupJson !== 'object') return false
  await copyFileAtomic(backupFile, runtimeFile)
  return true
}

async function restoreConfig(backupFile, runtimeFile) {
  if (!(await exists(backupFile))) return false
  const backup = await readJson(backupFile)
  if (!backup) return false
  const current = await readJson(runtimeFile) || {}
  const merged = deepMerge(current, backup)
  // Campos pertencentes à build devem acompanhar a versão nova, enquanto as
  // preferências, donos, tokens e demais valores do usuário vêm do backup.
  if (current.schemaVersion != null) merged.schemaVersion = current.schemaVersion
  if (current.bot?.release) {
    merged.bot ||= {}
    merged.bot.release = current.bot.release
  }
  if (current.bot?.releaseChannel) {
    merged.bot ||= {}
    merged.bot.releaseChannel = current.bot.releaseChannel
  }
  await atomicWrite(runtimeFile, `${JSON.stringify(merged, null, 2)}\n`)
  return true
}

export async function snapshotPersistentBackup({ rootDir = process.cwd(), logger } = {}) {
  const root = path.resolve(rootDir)
  if (activeSnapshot) return activeSnapshot
  activeSnapshot = (async () => {
    try {
      const database = await import('./database.js')
      await database.flushDatabase?.()
    } catch {}
    const backupRoot = path.join(root, 'backup')
    await fsp.mkdir(backupRoot, { recursive: true })
    const copied = []

    for (const relative of FILES) {
      const safe = normalizeRelative(relative)
      const source = path.join(root, safe)
      if (!(await exists(source))) continue
      const destination = path.join(backupRoot, safe)
      await copyFileAtomic(source, destination)
      copied.push(safe)
    }

    for (const relative of DIRECTORIES) {
      const safe = normalizeRelative(relative)
      const source = path.join(root, safe)
      if (!(await exists(source))) continue
      const destination = path.join(backupRoot, safe)
      await copyDirectory(source, destination, { replace: true })
      copied.push(`${safe}/`)
    }

    const manifest = {
      format: BACKUP_FORMAT,
      updatedAt: new Date().toISOString(),
      entries: copied,
      policy: 'B',
      excludes: ['auth/.process.lock']
    }
    await atomicWrite(path.join(backupRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    logger?.debug?.({ stage: 'persistent-backup', entries: copied.length, backupRoot }, 'backup persistente atualizado')
    return { backupRoot, entries: copied.length, manifest }
  })().finally(() => { activeSnapshot = null })
  return activeSnapshot
}

export async function restorePersistentBackup({ rootDir = process.cwd(), logger, release = '' } = {}) {
  const root = path.resolve(rootDir)
  const backupRoot = path.join(root, 'backup')
  const storedManifest = await readJson(path.join(backupRoot, 'manifest.json'))
  const validStoredManifest = storedManifest && SUPPORTED_BACKUP_FORMATS.has(storedManifest.format) ? storedManifest : null
  const discoveredManifest = validStoredManifest ? null : await discoverBackupManifest(backupRoot)
  const manifest = validStoredManifest || discoveredManifest
  if (!manifest) return { restored: false, reason: 'backup-empty', backupRoot, discovered: false }

  let restoredCount = 0
  const envBackup = path.join(backupRoot, '.env')
  if (await exists(envBackup)) {
    await copyFileAtomic(envBackup, path.join(root, '.env'))
    restoredCount += 1
  }

  if (await restoreConfig(path.join(backupRoot, 'config/sakura.config.json'), path.join(root, 'config/sakura.config.json'))) restoredCount += 1

  const personalityBackup = path.join(backupRoot, 'config/ai-personality.txt')
  if (await exists(personalityBackup)) {
    await copyFileAtomic(personalityBackup, path.join(root, 'config/ai-personality.txt'))
    restoredCount += 1
  }

  if (await restoreDatabase(path.join(backupRoot, 'storage/sakura-db.json'), path.join(root, 'storage/sakura-db.json'))) restoredCount += 1

  for (const relative of DIRECTORIES) {
    const safe = normalizeRelative(relative)
    const source = path.join(backupRoot, safe)
    if (!(await exists(source))) continue
    const replace = safe === 'auth'
    restoredCount += await copyDirectory(source, path.join(root, safe), { replace, newerOnly: false })
  }

  // Nunca carregar um lock antigo de outra execução.
  await fsp.rm(path.join(root, 'auth/.process.lock'), { force: true }).catch(() => {})

  const restoreState = {
    restoredAt: new Date().toISOString(),
    release: String(release || ''),
    backupUpdatedAt: manifest.updatedAt || '',
    format: manifest.format,
    discovered: Boolean(manifest.discovered)
  }
  await atomicWrite(path.join(backupRoot, '.restore-state.json'), `${JSON.stringify(restoreState, null, 2)}
`)
  logger?.info?.({ stage: 'persistent-backup-restore', restoredCount, backupRoot, updatedAt: manifest.updatedAt, discovered: Boolean(manifest.discovered), release: restoreState.release }, 'backup persistente restaurado automaticamente antes da inicialização')
  return { restored: true, restoredCount, backupRoot, manifest, discovered: Boolean(manifest.discovered), restoreState }
}

export function startPersistentBackupScheduler({ rootDir = process.cwd(), logger, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (scheduler) return scheduler
  const safeInterval = Math.max(15_000, Number(intervalMs) || DEFAULT_INTERVAL_MS)
  scheduler = setInterval(() => {
    void snapshotPersistentBackup({ rootDir, logger }).catch(error => logger?.warn?.({ error, stage: 'persistent-backup' }, 'backup persistente periódico falhou'))
  }, safeInterval)
  scheduler.unref?.()
  return scheduler
}

export async function stopPersistentBackupScheduler({ rootDir = process.cwd(), logger, flush = true } = {}) {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
  if (!flush) return { flushed: false }
  const result = await snapshotPersistentBackup({ rootDir, logger })
  return { flushed: true, ...result }
}

export function persistentBackupPaths() {
  return { files: [...FILES], directories: [...DIRECTORIES], format: BACKUP_FORMAT }
}
