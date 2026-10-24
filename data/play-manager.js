import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { requestMedia } from './media-process-client.js'
import { enqueueMediaTask, mediaQueueSnapshot } from './media-priority.js'
import { settings } from './settings.js'

const SEARCH_TTL_MS = 10 * 60_000
const AUDIO_TTL_MS = 12 * 60 * 60_000
const PRUNE_INTERVAL_MS = 10 * 60_000
const MAX_CACHE_BYTES = 512 * 1024 * 1024

const searchCache = new Map()
const inflightResolve = new Map()
const inflightDownloads = new Map()
let lastPruneAt = 0
let warmPromise

function normalizedQuery(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function mediaKey(media = {}) {
  const seed = String(media.videoId || media.videoUrl || media.query || '').trim()
  return createHash('sha1').update(seed || 'unknown').digest('hex')
}

function cacheDir() {
  return path.join(settings.cacheDir, 'play')
}

async function readCachedAudio(resolved = {}) {
  const key = mediaKey(resolved)
  const metadataPath = path.join(cacheDir(), `${key}.json`)
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
    const filePath = path.join(cacheDir(), String(metadata.fileName || ''))
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size < 16 * 1024 || Date.now() - Number(metadata.cachedAt || stat.mtimeMs) > AUDIO_TTL_MS) return null
    return { ...resolved, ...metadata.media, filePath, outputBytes: stat.size, cleanup: [], cacheHit: true }
  } catch {
    return null
  }
}

async function persistAudio(media = {}) {
  if (!media.filePath) return media
  const key = mediaKey(media)
  await fs.mkdir(cacheDir(), { recursive: true })
  const ext = String(media.extension || path.extname(media.filePath).slice(1) || 'm4a').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'm4a'
  const fileName = `${key}.${ext}`
  const target = path.join(cacheDir(), fileName)
  if (path.resolve(media.filePath) !== path.resolve(target)) {
    await fs.copyFile(media.filePath, target)
    await fs.rm(media.filePath, { force: true }).catch(() => {})
  }
  const stat = await fs.stat(target)
  const stored = { ...media, filePath: target, outputBytes: stat.size, cleanup: [], cacheHit: false }
  const serializable = { ...stored }
  delete serializable.cleanup
  await fs.writeFile(path.join(cacheDir(), `${key}.json`), `${JSON.stringify({ cachedAt: Date.now(), fileName, media: serializable }, null, 2)}\n`)
  return stored
}

async function pruneCache(logger) {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return
  lastPruneAt = Date.now()
  const dir = cacheDir()
  await fs.mkdir(dir, { recursive: true })
  let entries = []
  try {
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (name.endsWith('.json')) continue
      const filePath = path.join(dir, name)
      try {
        const stat = await fs.stat(filePath)
        if (stat.isFile()) entries.push({ filePath, name, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {}
    }
  } catch { return }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let total = entries.reduce((sum, item) => sum + item.size, 0)
  for (const entry of entries) {
    if (Date.now() - entry.mtimeMs <= AUDIO_TTL_MS && total <= MAX_CACHE_BYTES) continue
    await fs.rm(entry.filePath, { force: true }).catch(() => {})
    await fs.rm(path.join(dir, `${path.parse(entry.name).name}.json`), { force: true }).catch(() => {})
    total -= entry.size
  }
  logger?.debug?.({ stage: 'play-cache-prune', files: entries.length, bytes: Math.max(0, total) }, 'cache do .play revisado')
}

export async function resolvePlay(query, { logger } = {}) {
  const key = normalizedQuery(query)
  if (!key) throw Object.assign(new Error('Informe uma música para o .play.'), { errorType: 'EMPTY_QUERY' })
  const cached = searchCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, searchCacheHit: true }
  if (inflightResolve.has(key)) return inflightResolve.get(key)

  const promise = (async () => {
    const startedAt = Date.now()
    const resolved = await requestMedia('play-search', { query }, { timeoutMs: 30_000 })
    searchCache.set(key, { value: resolved, expiresAt: Date.now() + SEARCH_TTL_MS })
    logger?.info?.({ stage: 'play-manager-resolve', videoId: resolved.videoId, durationMs: Date.now() - startedAt }, 'busca do .play resolvida')
    return resolved
  })().finally(() => inflightResolve.delete(key))
  inflightResolve.set(key, promise)
  return promise
}

export async function downloadPlay(resolved, { vip = false, logger } = {}) {
  await pruneCache(logger).catch(() => {})
  const cached = await readCachedAudio(resolved)
  if (cached) {
    logger?.success?.({ stage: 'play-cache-hit', videoId: cached.videoId, bytes: cached.outputBytes }, 'áudio do .play servido do cache')
    return cached
  }

  const key = mediaKey(resolved)
  if (inflightDownloads.has(key)) {
    logger?.info?.({ stage: 'play-dedupe', videoId: resolved.videoId }, 'download idêntico do .play reutilizado')
    return inflightDownloads.get(key)
  }

  const promise = enqueueMediaTask(async ({ queueWaitMs, priority }) => {
    const startedAt = Date.now()
    logger?.info?.({ stage: 'play-queue-start', videoId: resolved.videoId, queueWaitMs, priority, queue: mediaQueueSnapshot() }, 'download do .play iniciou na fila')
    const media = await requestMedia('play-download', { resolved }, { timeoutMs: 90_000 })
    const stored = await persistAudio(media)
    logger?.success?.({ stage: 'play-manager-download', videoId: stored.videoId, bytes: stored.outputBytes, queueWaitMs, durationMs: Date.now() - startedAt }, 'download do .play finalizado e cacheado')
    return stored
  }, { vip }).finally(() => inflightDownloads.delete(key))

  inflightDownloads.set(key, promise)
  return promise
}

export function getPlayManagerState() {
  return {
    searchCache: searchCache.size,
    resolving: inflightResolve.size,
    downloading: inflightDownloads.size,
    mediaQueue: mediaQueueSnapshot()
  }
}

export function warmPlayManager(logger) {
  warmPromise ||= requestMedia('warm', {}, { timeoutMs: 190_000 })
    .then(result => {
      if (result?.available) logger?.success?.({ stage: 'play-warm', version: result.version, source: result.source }, 'motor do .play aquecido')
      else logger?.warn?.({ stage: 'play-warm', error: result?.error }, 'motor do .play não pôde ser aquecido')
      return result
    })
    .catch(error => {
      logger?.warn?.({ stage: 'play-warm', error: error?.message }, 'aquecimento do .play falhou; nova tentativa ocorrerá sob demanda')
      return { available: false, error: error?.message || String(error) }
    })
    .finally(() => { warmPromise = null })
  return warmPromise
}
