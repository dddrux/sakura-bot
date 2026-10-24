import fs from 'node:fs/promises'
import path from 'node:path'
import dns from 'node:dns/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID, createHash } from 'node:crypto'
import { settings } from './settings.js'
import { downloadGenericWithYtDlp } from './player/yt-dlp-engine.js'
import { downloadTikTok, isTikTokUrl } from './tiktok.js'
import { enqueueMediaTask } from './media-priority.js'
import { getVipBenefits } from './vip.js'
import { getAutomationConfig, isQuietHoursActive, reserveAutoDownloadUrl } from './automation-store.js'
import { formatMessage } from './formatter.js'

const queues = new Map()

function cleanUrl(value = '') {
  return String(value || '').trim().replace(/[),.;!?]+$/, '')
}

export function extractHttpUrls(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>()]+/gi) || []
  return [...new Set(matches.map(cleanUrl).filter(Boolean))].slice(0, settings.autoDownloadMaxLinksPerMessage || 3)
}

function ipv4Private(host = '') {
  const parts = String(host).split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a,b] = parts
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
}

function ipv6Private(host = '') {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h.startsWith('::ffff:')) return ipv4Private(h.slice(7))
  return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h) || h.startsWith('ff')
}

function privateHost(host = '') {
  const h = String(host || '').toLowerCase().replace(/\.$/, '')
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || ipv4Private(h) || ipv6Private(h)
}

export function validatePublicMediaUrl(value = '') {
  let parsed
  try { parsed = new URL(String(value || '')) } catch { return { ok: false, reason: 'url-invalida' } }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, reason: 'protocolo' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'credenciais' }
  if (privateHost(parsed.hostname)) return { ok: false, reason: 'host-privado' }
  return { ok: true, url: parsed.toString(), hostname: parsed.hostname }
}

async function ensurePublicResolution(value) {
  const validated = validatePublicMediaUrl(value)
  if (!validated.ok) throw Object.assign(new Error('URL privada ou inválida bloqueada.'), { code: 'AUTO_DL_UNSAFE_URL' })
  try {
    const rows = await dns.lookup(validated.hostname, { all: true, verbatim: true })
    if (!rows.length || rows.some(row => privateHost(row.address))) throw new Error('resolução privada')
  } catch (error) {
    if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') throw error
    throw Object.assign(new Error('Destino local/privado bloqueado.'), { code: 'AUTO_DL_UNSAFE_URL' })
  }
  return validated.url
}

function extensionForMime(mime = '') {
  const m = String(mime || '').split(';')[0].trim().toLowerCase()
  return ({
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'audio/ogg': '.ogg', 'audio/webm': '.webm'
  })[m] || ''
}

async function directMedia(url, maxBytes) {
  if (typeof fetch !== 'function') return null
  let current = url
  for (let redirect = 0; redirect < 5; redirect += 1) {
    current = await ensurePublicResolution(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000); timer.unref?.()
    let response
    try {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 Sakura-MD/2' } })
    } finally { clearTimeout(timer) }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location')
      try { await response.body?.cancel?.() } catch {}
      if (!location) return null
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) { try { await response.body?.cancel?.() } catch {}; return null }
    const mime = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    if (!/^(?:image|video|audio)\//.test(mime)) { try { await response.body?.cancel?.() } catch {}; return null }
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > maxBytes) throw Object.assign(new Error('mídia excede o limite do AutoDownload'), { code: 'SOURCE_TOO_LARGE' })
    const ext = extensionForMime(mime) || path.extname(new URL(current).pathname).slice(0, 8) || '.bin'
    await fs.mkdir(settings.tmpDir, { recursive: true })
    const filePath = path.join(settings.tmpDir, `auto-url-${randomUUID()}${ext}`)
    let bytes = 0
    const limiter = new Transform({ transform(chunk, enc, cb) { bytes += chunk.length; if (bytes > maxBytes) return cb(Object.assign(new Error('mídia excede o limite do AutoDownload'), { code: 'SOURCE_TOO_LARGE' })); cb(null, chunk) } })
    try {
      await pipeline(Readable.fromWeb(response.body), limiter, (await import('node:fs')).createWriteStream(filePath))
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'video'
      return { filePath, kind, mimetype: mime, bytes, title: path.basename(new URL(current).pathname) || 'Mídia', webpageUrl: current }
    } catch (error) { await fs.rm(filePath, { force: true }).catch(() => {}); throw error }
  }
  return null
}


export function downloadStrategyForUrl(url = '') {
  return isTikTokUrl(url) ? 'tiktok' : 'generic'
}

export async function downloadAnyMediaUrl(url, { maxBytes, logger } = {}) {
  const safe = await ensurePublicResolution(url)
  const direct = await directMedia(safe, maxBytes)
  if (direct) return { ...direct, cleanup: [direct.filePath], engine: 'direct' }
  if (downloadStrategyForUrl(safe) === 'tiktok') {
    try {
      const result = await downloadTikTok(safe, { maxBytes })
      return { ...result, kind: 'video', mimetype: 'video/mp4', webpageUrl: safe, engine: 'tiktok', cleanup: result.cleanup || [result.filePath] }
    } catch (error) {
      logger?.warn?.({ error, stage: 'tiktok-fallback' }, 'downloader dedicado do TikTok falhou; tentando yt-dlp como último recurso')
    }
  }
  const outputBase = path.join(settings.tmpDir, `auto-ytdlp-${randomUUID()}`)
  const result = await downloadGenericWithYtDlp({ url: safe, outputBase, maxBytes, logger })
  return { ...result, cleanup: [result.filePath], engine: 'yt-dlp' }
}

function queueFor(chat) {
  if (!queues.has(chat)) queues.set(chat, { running: false, jobs: [] })
  return queues.get(chat)
}

async function runJob(job, logger) {
  const { sock, msg, url, senderNumber } = job
  const vip = await getVipBenefits(senderNumber)
  const maxBytes = Math.max(5, Number(vip.mediaLimitMb || settings.freeMediaLimitMb || 48)) * 1024 * 1024
  let result
  try {
    result = await enqueueMediaTask(() => downloadAnyMediaUrl(url, { maxBytes, logger }), { vip: vip.active })
    const caption = formatMessage(`título: ${result.title || 'Mídia'}\norigem: ${result.engine}\nplano: ${vip.planName}`, { title: 'DOWNLOAD AUTOMÁTICO' })
    const content = result.kind === 'image' ? { image: { url: result.filePath }, mimetype: result.mimetype, caption }
      : result.kind === 'audio' ? { audio: { url: result.filePath }, mimetype: result.mimetype, ptt: false }
        : { video: { url: result.filePath }, mimetype: result.mimetype || 'video/mp4', caption }
    await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg })
    logger?.info?.({ chat: msg.key.remoteJid, urlHash: createHash('sha256').update(url).digest('hex').slice(0,12), kind: result.kind, bytes: result.bytes, engine: result.engine }, 'AutoDownload enviou mídia do link')
  } catch (error) {
    logger?.warn?.({ error, chat: msg.key.remoteJid, stage: 'auto-download' }, 'AutoDownload ignorou/falhou neste link')
  } finally {
    await Promise.all((result?.cleanup || []).map(file => fs.rm(file, { recursive: true, force: true }).catch(() => {})))
  }
}

function pump(chat, logger) {
  const queue = queueFor(chat)
  if (queue.running) return
  const job = queue.jobs.shift()
  if (!job) { queues.delete(chat); return }
  queue.running = true
  void runJob(job, logger).finally(() => { queue.running = false; pump(chat, logger) })
}

export function maybeQueueAutoDownload({ sock, msg, text, senderNumber, logger } = {}) {
  const chat = String(msg?.key?.remoteJid || '')
  if (!chat) return { queued: 0 }
  const config = getAutomationConfig(chat)
  if (!config.autoDownloadEnabled || isQuietHoursActive(config)) return { queued: 0 }
  const urls = extractHttpUrls(text).filter(url => validatePublicMediaUrl(url).ok)
  if (!urls.length) return { queued: 0 }
  const queue = queueFor(chat)
  let queued = 0
  for (const url of urls) {
    if (queue.jobs.length >= Math.max(1, Number(settings.autoMediaQueuePerChat || 6))) break
    if (!reserveAutoDownloadUrl(chat, url)) continue
    queue.jobs.push({ sock, msg, url, senderNumber })
    queued += 1
  }
  if (queued) pump(chat, logger)
  return { queued, pending: queue.jobs.length, running: queue.running }
}

export function autoDownloadStatus() {
  return { chats: queues.size, pending: [...queues.values()].reduce((sum, q) => sum + q.jobs.length, 0), running: [...queues.values()].filter(q => q.running).length }
}
