import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './database.js'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { getMediaKind, getMediaTarget, unwrapMessage } from './messages.js'
import { suppressCommandOfficialLinks } from './command-ui-state.js'

const ROOT = settings.commandMediaDir
const MAX_ITEMS = 12
const MAX_REDIRECTS = 3
const REMOTE_TIMEOUT_MS = 12_000
const LIMITS = Object.freeze({
  image: 8 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 12 * 1024 * 1024
})
const MAX_REMOTE_BYTES = Math.max(...Object.values(LIMITS))
const CACHE_MS = 60_000
const store = openDatabase(settings.commandMediaDb, { version: 2, items: {}, permissions: {} })
const cache = new Map()

const clean = (value, max = 100) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '')
  .slice(0, max)
const scopeKey = chat => String(chat || '*').trim() || '*'

function ensure(db) {
  db.version = 2
  db.items ||= {}
  db.permissions ||= {}
  return db
}

function invalidate(command, scope) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${command}:${scope}:`)) cache.delete(key)
  }
}

function nodeFor(target, kind) {
  const { content } = unwrapMessage(target?.message || {})
  if (kind === 'image') return content.imageMessage
  if (kind === 'video') return content.videoMessage
  return content.audioMessage
}

function detectKind(target) {
  const direct = getMediaKind(target?.message)
  if (direct) return direct
  const { content } = unwrapMessage(target?.message || {})
  return content.audioMessage ? 'audio' : ''
}

function extension(kind, mime = '') {
  const normalized = String(mime || '').toLowerCase()
  if (kind === 'image') {
    if (normalized.includes('png')) return '.png'
    if (normalized.includes('webp')) return '.webp'
    if (normalized.includes('gif')) return '.gif'
    return '.jpg'
  }
  if (kind === 'audio') {
    if (normalized.includes('ogg') || normalized.includes('opus')) return '.ogg'
    if (normalized.includes('wav')) return '.wav'
    if (normalized.includes('mp4') || normalized.includes('aac')) return '.m4a'
    return '.mp3'
  }
  if (normalized.includes('webm')) return '.webm'
  return '.mp4'
}

function normalizeJidNumber(value) {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

export function normalizeMediaCommand(value) {
  return clean(value, 50)
}

export function normalizeMediaBucket(value = 'default') {
  const raw = String(value || 'default').trim().toLowerCase()
  if (/^\d{1,3}-\d{1,3}$/.test(raw)) {
    const [start, end] = raw.split('-').map(Number)
    if (start >= 0 && end <= 100 && start <= end) return `${start}-${end}`
  }
  return clean(raw, 40) || 'default'
}

export function getGroupMediaAdminPermission(chat) {
  const key = scopeKey(chat)
  const row = ensure(store.readSync()).permissions[key]
  return { chat: key, enabled: Boolean(row?.admins_enabled), actor: String(row?.actor || ''), updatedAt: Number(row?.updated_at || 0) }
}

export function setGroupMediaAdminPermission(chat, enabled, actor = '') {
  const key = scopeKey(chat)
  if (!key.endsWith('@g.us')) throw new TypeError('A permissão de mídia só pode ser configurada em grupos.')
  store.updateSync(db => {
    ensure(db).permissions[key] = { admins_enabled: Number(Boolean(enabled)), actor: normalizeJidNumber(actor), updated_at: Date.now() }
  })
  return getGroupMediaAdminPermission(key)
}

export function isBlockedAddress(address) {
  const value = String(address || '').trim().toLowerCase()
  const family = net.isIP(value)
  if (!family) return true
  if (family === 4) {
    const parts = value.split('.').map(Number)
    const [a, b] = parts
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0)
  }
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true
  if (value.startsWith('ff') || value.startsWith('2001:db8:')) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  return mapped ? isBlockedAddress(mapped[1]) : false
}

export function parseRemoteMediaUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new TypeError('URL de mídia inválida.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Use apenas URLs HTTP ou HTTPS.')
  if (url.username || url.password) throw new TypeError('URLs com usuário ou senha não são permitidas.')
  if (url.port && !['80', '443'].includes(url.port)) throw new TypeError('Portas personalizadas não são permitidas em URLs de mídia.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new TypeError('Endereço local não permitido.')
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) throw new TypeError('Endereço privado ou reservado não permitido.')
  url.hash = ''
  return url
}

async function resolvePublicAddress(url) {
  const parsed = parseRemoteMediaUrl(url)
  if (net.isIP(parsed.hostname)) return { url: parsed, address: parsed.hostname, family: net.isIP(parsed.hostname) }
  let addresses
  try { addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true }) } catch {
    throw new TypeError('Não foi possível resolver o domínio da mídia.')
  }
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address))) {
    throw new TypeError('O domínio aponta para uma rede privada ou reservada.')
  }
  const selected = addresses.find(item => item.family === 4) || addresses[0]
  return { url: parsed, address: selected.address, family: selected.family }
}

function sniffMedia(buffer, headerMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new TypeError('Arquivo de mídia vazio ou corrompido.')
  const mime = String(headerMime || '').split(';')[0].trim().toLowerCase()
  const starts = (...bytes) => bytes.every((byte, index) => buffer[index] === byte)
  if (starts(0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg' }
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', mime: 'image/png' }
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return { kind: 'image', mime: 'image/gif' }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', mime: 'image/webp' }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return { kind: 'audio', mime: mime.includes('opus') ? 'audio/ogg; codecs=opus' : 'audio/ogg' }
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return { kind: 'audio', mime: 'audio/wav' }
  if (buffer.length > 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return mime.startsWith('audio/')
      ? { kind: 'audio', mime: mime || 'audio/mp4' }
      : { kind: 'video', mime: 'video/mp4' }
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', mime: 'video/webm' }
  throw new TypeError('O conteúdo recebido não é uma imagem, GIF, vídeo ou áudio suportado.')
}

function requestRemoteBuffer(inputUrl, redirectsLeft = MAX_REDIRECTS) {
  return resolvePublicAddress(inputUrl).then(({ url, address, family }) => new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(url, {
      method: 'GET',
      headers: {
        accept: 'image/*,video/mp4,video/webm,audio/*;q=0.9,*/*;q=0.1',
        'user-agent': 'SakuraBot-Media/1.0'
      },
      lookup(hostname, options, callback) {
        if (typeof options === 'function') return options(null, address, family)
        if (options?.all) return callback(null, [{ address, family }])
        return callback(null, address, family)
      },
      timeout: REMOTE_TIMEOUT_MS
    }, response => {
      const status = Number(response.statusCode || 0)
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) return reject(new TypeError('A URL excedeu o limite de redirecionamentos.'))
        const redirected = new URL(response.headers.location, url)
        return requestRemoteBuffer(redirected, redirectsLeft - 1).then(resolve, reject)
      }
      if (status !== 200) {
        response.resume()
        return reject(new TypeError(`O servidor da mídia respondeu com HTTP ${status || 'inválido'}.`))
      }
      const declared = Number(response.headers['content-length'] || 0)
      if (declared > MAX_REMOTE_BYTES) {
        response.resume()
        return reject(new TypeError(`A mídia remota ultrapassa ${Math.floor(MAX_REMOTE_BYTES / 1024 / 1024)} MB.`))
      }
      const chunks = []
      let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > MAX_REMOTE_BYTES) {
          request.destroy(new TypeError(`A mídia remota ultrapassa ${Math.floor(MAX_REMOTE_BYTES / 1024 / 1024)} MB.`))
          return
        }
        chunks.push(chunk)
      })
      response.once('end', () => resolve({
        buffer: Buffer.concat(chunks),
        mime: String(response.headers['content-type'] || ''),
        sourceUrl: url.toString()
      }))
      response.once('error', reject)
    })
    request.once('timeout', () => request.destroy(new TypeError('O download da mídia excedeu o tempo limite.')))
    request.once('error', reject)
    request.end()
  }))
}

async function persistMedia({ buffer, command, scope, bucket, actor, replace, kind, mime, sourceUrl = '' }) {
  if (buffer.length > LIMITS[kind]) throw new TypeError(`A mídia ultrapassa ${Math.floor(LIMITS[kind] / 1024 / 1024)} MB.`)
  const current = Object.values(ensure(store.readSync()).items).filter(row => row.command === command && row.scope === scope && row.bucket === bucket)
  if (!replace && current.length >= MAX_ITEMS) throw new TypeError(`Limite de ${MAX_ITEMS} mídias por comando/faixa atingido.`)
  const oldRows = replace ? current : []
  const dir = path.join(ROOT, command)
  await fsp.mkdir(dir, { recursive: true })
  const id = randomUUID()
  const filename = path.join(dir, `${id}${extension(kind, mime)}`)
  await fsp.writeFile(filename, buffer, { flag: 'wx' })
  const row = {
    id, command, scope, bucket, kind, filename, mime_type: String(mime || ''), size_bytes: buffer.length,
    source_url: String(sourceUrl || ''), enabled: 1, actor: normalizeJidNumber(actor), created_at: Date.now()
  }
  try {
    store.updateSync(db => {
      ensure(db)
      if (replace) for (const old of Object.values(db.items)) if (old.command === command && old.scope === scope && old.bucket === bucket) delete db.items[old.id]
      db.items[id] = row
    })
  } catch (error) {
    await fsp.rm(filename, { force: true })
    throw error
  }
  await Promise.all(oldRows.map(old => fsp.rm(old.filename, { force: true }).catch(() => {})))
  invalidate(command, scope)
  return { id, command, scope, bucket, kind, filename, mimeType: mime, sizeBytes: buffer.length, sourceUrl }
}

export async function saveCommandMedia({ msg, logger, command, scope = '*', bucket = 'default', actor = '', replace = false, url = '' }) {
  command = normalizeMediaCommand(command)
  bucket = normalizeMediaBucket(bucket)
  scope = scopeKey(scope)
  if (!command) throw new TypeError('Comando inválido.')

  if (url) {
    const remote = await requestRemoteBuffer(url)
    const detected = sniffMedia(remote.buffer, remote.mime)
    return persistMedia({
      ...remote,
      command,
      scope,
      bucket,
      actor,
      replace,
      kind: detected.kind,
      mime: detected.mime
    })
  }

  const target = getMediaTarget(msg)
  if (!target) throw new TypeError('Responda a uma mídia ou informe uma URL HTTP/HTTPS segura.')
  const kind = detectKind(target)
  if (!LIMITS[kind]) throw new TypeError('Formato não suportado. Use imagem, GIF, vídeo curto ou áudio.')
  const node = nodeFor(target, kind) || {}
  const seconds = Number(node.seconds || 0)
  if (kind === 'video' && seconds > 20) throw new TypeError('O vídeo precisa ter no máximo 20 segundos.')
  if (kind === 'audio' && seconds > 60) throw new TypeError('O áudio precisa ter no máximo 60 segundos.')
  const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger })
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Não foi possível ler a mídia.')
  const detected = sniffMedia(buffer, node.mimetype)
  if (detected.kind !== kind && !(kind === 'video' && detected.kind === 'image' && detected.mime === 'image/gif')) {
    throw new TypeError('O conteúdo da mídia não corresponde ao formato informado pelo WhatsApp.')
  }
  return persistMedia({
    buffer,
    command,
    scope,
    bucket,
    actor,
    replace,
    kind: detected.kind,
    mime: detected.mime
  })
}

export function listCommandMedia(command, scope = '*', bucket) {
  command = normalizeMediaCommand(command)
  scope = scopeKey(scope)
  const safeBucket = bucket ? normalizeMediaBucket(bucket) : ''
  const rows = Object.values(ensure(store.readSync()).items)
    .filter(row => row.command === command && row.scope === scope && (!safeBucket || row.bucket === safeBucket))
    .sort((a, b) => safeBucket ? Number(a.created_at) - Number(b.created_at) : String(a.bucket).localeCompare(String(b.bucket)) || Number(a.created_at) - Number(b.created_at))
  return rows.map((row, index) => ({ ...row, index: index + 1 }))
}

export async function deleteCommandMedia(command, scope, index) {
  const rows = listCommandMedia(command, scope)
  const row = rows[Number(index) - 1]
  if (!row) return null
  store.updateSync(db => { ensure(db); delete db.items[row.id] })
  await fsp.rm(row.filename, { force: true }).catch(() => {})
  invalidate(normalizeMediaCommand(command), scopeKey(scope))
  return row
}

export async function clearCommandMedia(command, scope = '*') {
  const rows = listCommandMedia(command, scope)
  const safeCommand = normalizeMediaCommand(command)
  const safeScope = scopeKey(scope)
  store.updateSync(db => { ensure(db); for (const row of Object.values(db.items)) if (row.command === safeCommand && row.scope === safeScope) delete db.items[row.id] })
  await Promise.all(rows.map(row => fsp.rm(row.filename, { force: true }).catch(() => {})))
  invalidate(normalizeMediaCommand(command), scopeKey(scope))
  return rows.length
}

export function setCommandMediaEnabled(command, scope = '*', enabled = true) {
  const safeCommand = normalizeMediaCommand(command)
  const safeScope = scopeKey(scope)
  let changes = 0
  store.updateSync(db => {
    ensure(db)
    for (const row of Object.values(db.items)) {
      if (row.command === safeCommand && row.scope === safeScope) { row.enabled = Number(Boolean(enabled)); changes++ }
    }
  })
  invalidate(safeCommand, safeScope)
  return changes
}

function matchingBucket(percent, category, rows) {
  if (category) {
    const exact = rows.filter(row => row.bucket === normalizeMediaBucket(category))
    if (exact.length) return exact
  }
  if (Number.isFinite(percent)) {
    const ranged = rows.filter(row => {
      const match = /^(\d+)-(\d+)$/.exec(row.bucket)
      return match && percent >= Number(match[1]) && percent <= Number(match[2])
    })
    if (ranged.length) return ranged
  }
  return rows.filter(row => row.bucket === 'default')
}

function cachedRows(command, scope) {
  const key = `${command}:${scope}:all`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.rows
  const rows = Object.values(ensure(store.readSync()).items)
    .filter(row => row.command === command && row.scope === scope && Boolean(row.enabled) && fs.existsSync(row.filename))
    .sort((a, b) => Number(a.created_at) - Number(b.created_at))
  cache.set(key, { rows, expires: Date.now() + CACHE_MS })
  return rows
}

export function resolveCommandMedia(command, { chat = '', percent, category } = {}) {
  command = normalizeMediaCommand(command)
  for (const scope of [scopeKey(chat), '*']) {
    const candidates = matchingBucket(percent, category, cachedRows(command, scope))
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)]
  }
  const base = path.join(settings.assetsDir, 'command-media', command)
  for (const [kind, extensions] of [
    ['image', ['jpg', 'jpeg', 'png', 'webp', 'gif']],
    ['video', ['mp4', 'webm']],
    ['audio', ['mp3', 'ogg', 'wav']]
  ]) {
    for (const ext of extensions) {
      const filename = `${base}.${ext}`
      if (fs.existsSync(filename)) return { kind, filename, bucket: 'default', scope: 'builtin' }
    }
  }
  return null
}

export async function sendCommandResult({ sock, msg, command, caption, mentions = [], percent, category }) {
  const media = resolveCommandMedia(command, { chat: msg.key.remoteJid, percent, category })
  if (!media) return sock.sendMessage(msg.key.remoteJid, { text: caption, mentions }, { quoted: msg })
  suppressCommandOfficialLinks(msg)
  try {
    if (media.kind === 'image') {
      return await sock.sendMessage(msg.key.remoteJid, {
        image: { url: media.filename },
        mimetype: media.mime_type || undefined,
        caption,
        mentions
      }, { quoted: msg })
    }
    if (media.kind === 'video') {
      return await sock.sendMessage(msg.key.remoteJid, {
        video: { url: media.filename },
        mimetype: media.mime_type || 'video/mp4',
        caption,
        gifPlayback: true,
        mentions
      }, { quoted: msg })
    }
    await sock.sendMessage(msg.key.remoteJid, { text: caption, mentions }, { quoted: msg })
    return await sock.sendMessage(msg.key.remoteJid, {
      audio: { url: media.filename },
      mimetype: media.mime_type || 'audio/mpeg',
      ptt: false
    })
  } catch {
    return sock.sendMessage(msg.key.remoteJid, { text: caption, mentions }, { quoted: msg })
  }
}

export function commandMediaStoreStatus() {
  const db = ensure(store.readSync())
  const rows = Object.values(db.items)
  return {
    items: rows.length,
    enabledItems: rows.filter(row => Boolean(row.enabled)).length,
    groupsWithAdminPermission: Object.values(db.permissions).filter(row => Boolean(row.admins_enabled)).length,
    cacheEntries: cache.size
  }
}

export function closeCommandMediaStore() { cache.clear() }
