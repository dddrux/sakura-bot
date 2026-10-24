import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { settings } from '../settings.js'

const RELEASE_BASE = String(process.env.YTDLP_RELEASE_BASE || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download').replace(/\/$/, '')
const MAX_BINARY_BYTES = 80 * 1024 * 1024
const MAX_CAPTURE_BYTES = 96 * 1024
const INSTALL_TIMEOUT_MS = 180_000
const DOWNLOAD_TIMEOUT_MS = 75_000
let installPromise
let resolvedBinary
let resolvedVersion

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback
  return /^(1|true|yes|sim|on)$/i.test(String(value))
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))]
}

function validCookieFile(candidate = '') {
  if (!candidate) return false
  try {
    const stat = fsSync.statSync(candidate)
    if (!stat.isFile() || stat.size < 64) return false
    const header = fsSync.readFileSync(candidate, 'utf8').slice(0, 256)
    return /^# (?:Netscape )?HTTP Cookie File/m.test(header)
  } catch {
    return false
  }
}

export function resolveYtDlpCookieFile(preferred = '') {
  const configured = String(process.env.YOUTUBE_COOKIE_FILE || process.env.YTDLP_COOKIE_FILE || '').trim()
  const candidates = unique([
    configured && path.isAbsolute(configured) ? configured : configured ? path.resolve(process.cwd(), configured) : '',
    preferred,
    settings.youtubeCookieFile,
    path.resolve(process.cwd(), 'config', 'private', 'youtube-cookies.txt'),
    path.join(settings.rootDir || process.cwd(), 'config', 'private', 'youtube-cookies.txt')
  ])
  return candidates.find(validCookieFile) || ''
}

function browserCookieCandidates() {
  const configured = String(process.env.YTDLP_COOKIES_FROM_BROWSER || 'auto').trim()
  if (/^(?:0|false|off|no|none)$/i.test(configured)) return []
  if (configured && !/^auto$/i.test(configured)) return [configured]

  const home = os.homedir()
  const candidates = []
  if (fsSync.existsSync(path.join(home, '.mozilla', 'firefox', 'profiles.ini'))) candidates.push('firefox')
  if (fsSync.existsSync(path.join(home, '.config', 'google-chrome'))) candidates.push('chrome')
  if (fsSync.existsSync(path.join(home, '.config', 'chromium'))) candidates.push('chromium')
  if (fsSync.existsSync(path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'))) candidates.push('brave')
  return candidates
}

export function getYtDlpCookieState(preferred = '') {
  const cookieFile = resolveYtDlpCookieFile(preferred)
  let cookieBytes = 0
  let relevantCookies = 0
  let hasAuthentication = false
  if (cookieFile) {
    try {
      const content = fsSync.readFileSync(cookieFile, 'utf8')
      cookieBytes = Buffer.byteLength(content)
      const rows = content.split(/\r?\n/).filter(line => line && !line.startsWith('#'))
      const relevant = rows.filter(line => /(?:^|\.)youtube\.com\t/i.test(line))
      relevantCookies = relevant.length
      hasAuthentication = relevant.some(line => /\t(?:SID|SAPISID|__Secure-1PSID|__Secure-3PSID|LOGIN_INFO)\t/.test(line))
    } catch {}
  }
  const browserSources = browserCookieCandidates()
  return { cookieFile, cookieAvailable: Boolean(cookieFile), cookieBytes, relevantCookies, hasAuthentication, browserSources }
}

export function resolveYtDlpReleaseAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'linux' && arch === 'x64') return { asset: 'yt-dlp_linux', fileName: 'yt-dlp' }
  if (platform === 'linux' && arch === 'arm64') return { asset: 'yt-dlp_linux_aarch64', fileName: 'yt-dlp' }
  if (platform === 'darwin') return { asset: 'yt-dlp_macos', fileName: 'yt-dlp' }
  if (platform === 'win32' && ['x64', 'arm64'].includes(arch)) {
    return { asset: arch === 'arm64' ? 'yt-dlp_win_arm64.exe' : 'yt-dlp.exe', fileName: 'yt-dlp.exe' }
  }
  return null
}

function localBinaryPath(platform = process.platform, arch = process.arch) {
  const release = resolveYtDlpReleaseAsset(platform, arch)
  return release ? path.join(settings.storageDir, 'bin', release.fileName) : ''
}

function compactOutput(value = '') {
  const text = String(value || '')
  return text.length > MAX_CAPTURE_BYTES ? text.slice(-MAX_CAPTURE_BYTES) : text
}

function runCaptured(command, args, { timeoutMs = 30_000, logger } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      const error = new Error(`${path.basename(command)} excedeu ${timeoutMs} ms`)
      error.errorType = 'YTDLP_TIMEOUT'
      error.stdout = compactOutput(stdout)
      error.stderr = compactOutput(stderr)
      clearInterval(heartbeat)
      reject(error)
    }, timeoutMs)
    timer.unref?.()
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      if (settled) return
      logger?.info?.({ elapsedMs: Date.now() - startedAt }, 'yt-dlp ainda está processando o áudio')
    }, 12_000)
    heartbeat.unref?.()

    child.stdout.on('data', chunk => { stdout = compactOutput(stdout + chunk.toString()) })
    child.stderr.on('data', chunk => { stderr = compactOutput(stderr + chunk.toString()) })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      reject(error)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      if (code === 0) return resolve({ code, stdout, stderr })
      const failure = classifyYtDlpError(new Error(stderr.trim() || stdout.trim() || `yt-dlp terminou com código ${code}`))
      failure.exitCode = code
      failure.stdout = compactOutput(stdout)
      failure.stderr = compactOutput(stderr)
      logger?.debug?.({ code, errorType: failure.errorType, stderr: failure.stderr.slice(-1500) }, 'motor yt-dlp recusou a mídia')
      reject(failure)
    })
  })
}

async function binaryWorks(command) {
  if (!command) return null
  try {
    const result = await runCaptured(command, ['--version'], { timeoutMs: 12_000 })
    const version = result.stdout.trim().split(/\s+/)[0] || result.stderr.trim().split(/\s+/)[0]
    return { command, version: version || 'desconhecida' }
  } catch {
    return null
  }
}

async function downloadWithSystemTool(url, { timeoutMs = INSTALL_TIMEOUT_MS, maxBytes = MAX_BINARY_BYTES } = {}) {
  await fs.mkdir(settings.tmpDir, { recursive: true })
  const output = path.join(settings.tmpDir, `yt-dlp-download-${randomUUID()}`)
  const seconds = Math.max(15, Math.ceil(timeoutMs / 1000))
  const tools = [
    ['curl', ['-L', '--fail', '--silent', '--show-error', '--connect-timeout', '20', '--max-time', String(seconds), '-o', output, url]],
    ['wget', ['-q', '--timeout=20', '--tries=3', '-O', output, url]]
  ]
  let lastError
  try {
    for (const [command, args] of tools) {
      try {
        await runCaptured(command, args, { timeoutMs })
        const stat = await fs.stat(output)
        if (stat.size < 1 || stat.size > maxBytes) throw new Error('download externo vazio ou grande demais')
        return await fs.readFile(output)
      } catch (error) {
        lastError = error
        await fs.rm(output, { force: true }).catch(() => {})
      }
    }
    throw lastError || new Error('curl e wget não estão disponíveis')
  } finally {
    await fs.rm(output, { force: true }).catch(() => {})
  }
}

async function fetchBuffer(url, { fetchImpl = globalThis.fetch, timeoutMs = INSTALL_TIMEOUT_MS, maxBytes = MAX_BINARY_BYTES } = {}) {
  let fetchError
  if (typeof fetchImpl === 'function') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: '*/*',
          'user-agent': 'Sakura-MD/1.2.3 yt-dlp installer'
        }
      })
      if (!response?.ok) {
        const error = new Error(`download do yt-dlp retornou HTTP ${response?.status || 0}`)
        error.status = Number(response?.status || 0) || undefined
        throw error
      }
      const length = Number(response.headers?.get?.('content-length') || 0)
      if (length > maxBytes) throw new Error('binário yt-dlp excede o limite permitido')
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > maxBytes) throw new Error('binário yt-dlp vazio ou grande demais')
      return buffer
    } catch (error) {
      fetchError = error
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await downloadWithSystemTool(url, { timeoutMs, maxBytes })
  } catch (toolError) {
    const error = new Error(`não foi possível baixar o motor oficial: ${fetchError?.message || toolError?.message || 'falha de rede'}`)
    error.errorType = 'YTDLP_DOWNLOAD_FAILED'
    error.cause = toolError
    throw error
  }
}

function expectedChecksum(checksumText, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(checksumText || '').match(new RegExp(`^([a-f0-9]{64})[ \\t]+\\*?${escaped}$`, 'im'))
  return match?.[1]?.toLowerCase() || ''
}

export async function installYtDlp({
  targetPath = localBinaryPath(),
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  logger
} = {}) {
  const release = resolveYtDlpReleaseAsset(platform, arch)
  if (!release || !targetPath) {
    const error = new Error(`yt-dlp automático não oferece binário para ${platform}/${arch}`)
    error.errorType = 'YTDLP_UNSUPPORTED_PLATFORM'
    throw error
  }

  const [binary, checksums] = await Promise.all([
    fetchBuffer(`${RELEASE_BASE}/${release.asset}`, { fetchImpl }),
    fetchBuffer(`${RELEASE_BASE}/SHA2-256SUMS`, { fetchImpl, maxBytes: 2 * 1024 * 1024 })
  ])
  const checksumText = checksums.toString('utf8')
  const expected = expectedChecksum(checksumText, release.asset)
  if (!expected) {
    const error = new Error(`checksum oficial de ${release.asset} não foi encontrado`)
    error.errorType = 'YTDLP_CHECKSUM_MISSING'
    throw error
  }
  const actual = createHash('sha256').update(binary).digest('hex')
  if (actual !== expected) {
    const error = new Error('checksum do yt-dlp não confere com a release oficial')
    error.errorType = 'YTDLP_CHECKSUM_MISMATCH'
    throw error
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const temporary = `${targetPath}.download-${process.pid}`
  await fs.writeFile(temporary, binary, { mode: 0o755 })
  if (platform !== 'win32') await fs.chmod(temporary, 0o755)
  await fs.rm(targetPath, { force: true }).catch(() => {})
  await fs.rename(temporary, targetPath)
  logger?.success?.({ targetPath, bytes: binary.length, asset: release.asset }, 'motor yt-dlp oficial instalado e verificado')
  return targetPath
}

export async function ensureYtDlp({ autoInstall = bool(process.env.SAKURA_AUTO_INSTALL_YTDLP, true), logger } = {}) {
  if (resolvedBinary) return { path: resolvedBinary, version: resolvedVersion, source: resolvedBinary === 'yt-dlp' ? 'system' : 'local' }

  const configured = String(process.env.YTDLP_PATH || '').trim()
  for (const candidate of [configured, localBinaryPath(), 'yt-dlp'].filter(Boolean)) {
    const working = await binaryWorks(candidate)
    if (working) {
      resolvedBinary = working.command
      resolvedVersion = working.version
      return { path: resolvedBinary, version: resolvedVersion, source: candidate === 'yt-dlp' ? 'system' : 'local' }
    }
  }

  if (!autoInstall) return { path: '', version: '', source: 'missing' }
  installPromise ||= (async () => {
    try {
      const installed = await installYtDlp({ logger })
      const working = await binaryWorks(installed)
      if (!working) throw new Error('yt-dlp instalado, mas não pôde ser executado')
      resolvedBinary = working.command
      resolvedVersion = working.version
      return { path: resolvedBinary, version: resolvedVersion, source: 'downloaded' }
    } catch (cause) {
      const error = classifyYtDlpError(cause)
      if (!error.errorType || error.errorType === 'YTDLP_FAILED') error.errorType = 'YTDLP_INSTALL_FAILED'
      throw error
    } finally {
      installPromise = null
    }
  })()
  return installPromise
}

function normalizeDate(value = '') {
  const clean = String(value || '').replace(/\D/g, '')
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}` : ''
}

export function mapYtDlpInfo(info = {}, fallback = {}) {
  const videoId = String(info.id || fallback.videoId || fallback.id || '').trim()
  return {
    title: String(info.title || fallback.title || videoId || 'Música'),
    track: String(info.track || fallback.track || '').trim(),
    artist: String(info.artist || fallback.artist || '').trim(),
    author: String(info.artist || info.uploader || info.channel || fallback.author || 'YouTube'),
    durationSeconds: Number(info.duration || fallback.durationSeconds || 0),
    viewCount: Number(info.view_count ?? fallback.viewCount ?? 0) || undefined,
    viewCountText: fallback.viewCountText || '',
    likeCount: Number.isFinite(Number(info.like_count ?? fallback.likeCount))
      ? Math.max(0, Math.floor(Number(info.like_count ?? fallback.likeCount)))
      : undefined,
    description: String(info.description || fallback.description || '').trim(),
    publishedText: fallback.publishedText || '',
    publishDate: normalizeDate(info.release_date || info.upload_date) || fallback.publishDate || '',
    uploadDate: normalizeDate(info.upload_date) || fallback.uploadDate || '',
    thumbnailUrl: String(info.thumbnail || fallback.thumbnailUrl || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '')),
    videoUrl: String(info.webpage_url || fallback.videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '')),
    videoId,
    client: 'yt-dlp',
    engine: 'yt-dlp'
  }
}

export function appendFfmpegLocation(args = [], ffmpegPath = settings.ffmpegPath) {
  const value = String(ffmpegPath || '').trim()
  if (!value) return args
  const looksLikePath = path.isAbsolute(value) || value.includes('/') || value.includes('\\')
  if (looksLikePath && fsSync.existsSync(value)) args.push('--ffmpeg-location', value)
  return args
}

function appendNetworkOptions(args) {
  const proxy = String(process.env.YTDLP_PROXY || '').trim()
  if (proxy) args.push('--proxy', proxy)
  if (bool(process.env.YTDLP_FORCE_IPV4, true)) args.push('--force-ipv4')
}

function anonymousPlayerClients() {
  return String(process.env.YTDLP_ANONYMOUS_CLIENTS || 'web_safari,web_embedded,android_vr')
    .split(',').map(value => value.trim()).filter(Boolean)
}

export function buildYtDlpArgs({
  url,
  outputBase,
  ffmpegPath = settings.ffmpegPath,
  cookieFile = '',
  useCookies = false,
  cookiesFromBrowser = '',
  formatMode = 'native-m4a',
  playerClients = '',
  writeInfo = true
} = {}) {
  const searchMode = /^ytsearch\d*:/i.test(String(url || ''))
  const formatSelectors = {
    'native-m4a': 'bestaudio[ext=m4a][filesize<128M]/bestaudio[acodec^=mp4a][filesize<128M]/bestaudio[ext=m4a][filesize_approx<128M]/bestaudio[acodec^=mp4a][filesize_approx<128M]/bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]',
    'native-any': 'bestaudio[filesize<128M]/bestaudio[filesize_approx<128M]/bestaudio',
    'safari-m4a': 'bestaudio/best',
    mp3: 'bestaudio[filesize<128M]/bestaudio[filesize_approx<128M]/bestaudio/best'
  }
  const args = [
    '--no-config', ...(searchMode ? ['--playlist-end', '1'] : ['--no-playlist']), '--color', 'never', '--newline',
    '--socket-timeout', '10', '--retries', '1', '--fragment-retries', '2', '--extractor-retries', '1',
    '--concurrent-fragments', '8', '--no-part', '--abort-on-unavailable-fragments', '--no-mtime', '--no-write-playlist-metafiles',
    '--js-runtimes', `node:${process.execPath}`,
    '--cache-dir', path.join(settings.cacheDir, 'yt-dlp'),
    '--format', formatSelectors[formatMode] || formatSelectors['native-m4a'],
    '--output', `${outputBase}.%(ext)s`,
    '--print', 'after_move:filepath'
  ]
  if (writeInfo) args.push('--write-info-json', '--clean-info-json', '--output', `infojson:${outputBase}.info.json`)
  appendFfmpegLocation(args, ffmpegPath)
  if (formatMode === 'mp3') args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5')
  if (formatMode === 'safari-m4a') args.push('--extract-audio', '--audio-format', 'm4a', '--audio-quality', '5')
  if (playerClients === 'web_safari') args.push('--hls-prefer-native')
  if (playerClients) args.push('--extractor-args', `youtube:player_client=${playerClients}`)
  appendNetworkOptions(args)
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser)
  else if (useCookies && cookieFile) args.push('--cookies', cookieFile)
  args.push('--', String(url || ''))
  return args
}

const YTDLP_METADATA_TEMPLATE = '%(.{id,title,track,artist,uploader,channel,duration,like_count,view_count,thumbnail,webpage_url})j'

function buildYtDlpSearchArgs({ query, cookieFile = '', useCookies = false, cookiesFromBrowser = '' } = {}) {
  const args = [
    '--no-config', '--color', 'never', '--no-warnings', '--skip-download', '--playlist-end', '1',
    '--print', YTDLP_METADATA_TEMPLATE,
    '--socket-timeout', '10', '--retries', '1', '--extractor-retries', '1',
    '--js-runtimes', `node:${process.execPath}`,
    '--cache-dir', path.join(settings.cacheDir, 'yt-dlp')
  ]
  appendNetworkOptions(args)
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser)
  else if (useCookies && cookieFile) args.push('--cookies', cookieFile)
  args.push('--', `ytsearch1:${String(query || '').replace(/^ytsearch\d*:/i, '').trim()}`)
  return args
}

function buildYtDlpInfoArgs({ url, cookieFile = '', useCookies = false, cookiesFromBrowser = '' } = {}) {
  const args = [
    '--no-config', '--no-playlist', '--color', 'never', '--no-warnings', '--skip-download',
    '--print', YTDLP_METADATA_TEMPLATE,
    '--socket-timeout', '10', '--retries', '1', '--extractor-retries', '1',
    '--js-runtimes', `node:${process.execPath}`,
    '--cache-dir', path.join(settings.cacheDir, 'yt-dlp')
  ]
  appendNetworkOptions(args)
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser)
  else if (useCookies && cookieFile) args.push('--cookies', cookieFile)
  args.push('--', String(url || ''))
  return args
}

function authAttemptsFor(cookieFile = settings.youtubeCookieFile) {
  const cookieState = getYtDlpCookieState(cookieFile)
  const noCookies = bool(process.env.PLAY_NO_COOKIES, true)
  const cookiesEnabled = !noCookies && bool(process.env.YTDLP_USE_COOKIES, false)
  const attempts = []
  if (cookiesEnabled && cookieState.cookieAvailable) attempts.push({ mode: 'arquivo', cookieFile: cookieState.cookieFile, useCookies: true, cookiesFromBrowser: '' })
  if (cookiesEnabled) {
    for (const source of cookieState.browserSources) attempts.push({ mode: `navegador:${source}`, cookieFile: '', useCookies: false, cookiesFromBrowser: source })
  }
  attempts.push({ mode: 'anônimo', cookieFile: '', useCookies: false, cookiesFromBrowser: '' })
  return { attempts, cookieState }
}

function parseYtDlpSearch(stdout = '') {
  const text = String(stdout || '').trim()
  if (!text) return []

  const payloads = []
  try {
    payloads.push(JSON.parse(text))
  } catch {
    for (const line of text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      try { payloads.push(JSON.parse(line)) } catch {}
    }
  }

  const entries = []
  for (const payload of payloads) {
    if (Array.isArray(payload?.entries)) entries.push(...payload.entries)
    else if (payload && typeof payload === 'object') entries.push(payload)
  }

  return entries.map(entry => {
    const id = String(entry?.id || '').trim()
    return {
      id,
      url: entry?.webpage_url || entry?.url || (id ? `https://www.youtube.com/watch?v=${id}` : ''),
      title: entry?.title || '',
      track: entry?.track || '',
      artist: entry?.artist || '',
      author: entry?.artist || entry?.uploader || entry?.channel || '',
      durationSeconds: Number(entry?.duration || 0),
      likeCount: Number.isFinite(Number(entry?.like_count)) ? Math.max(0, Math.floor(Number(entry.like_count))) : undefined,
      viewCount: Number.isFinite(Number(entry?.view_count)) ? Math.max(0, Math.floor(Number(entry.view_count))) : undefined,
      thumbnailUrl: entry?.thumbnail || entry?.thumbnails?.at?.(-1)?.url || ''
    }
  }).filter(item => item.id && item.url)
}

export async function resolveYtDlpMedia(queryOrUrl, { cookieFile = settings.youtubeCookieFile, deadline = 0, logger } = {}) {
  const clean = String(queryOrUrl || '').replace(/\s+/g, ' ').trim()
  if (!clean) throw Object.assign(new Error('Informe o nome da música ou um link do YouTube.'), { errorType: 'EMPTY_QUERY' })
  const engine = await ensureYtDlp({ autoInstall: true, logger })
  const hardDeadline = Math.min(deadline > Date.now() ? deadline : Number.POSITIVE_INFINITY, Date.now() + 25_000)
  const remainingMs = (cap = 20_000) => {
    const remaining = hardDeadline - Date.now()
    if (remaining <= 0) throw Object.assign(new Error('busca do .play excedeu o limite'), { errorType: 'YTDLP_TIMEOUT' })
    return Math.max(2_500, Math.min(cap, remaining))
  }
  const isUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(clean)
  const { attempts, cookieState } = authAttemptsFor(cookieFile)
  let lastError
  for (const auth of attempts) {
    try {
      if (!isUrl) {
        const result = await runCaptured(engine.path, buildYtDlpSearchArgs({
          query: clean,
          cookieFile: auth.cookieFile,
          useCookies: auth.useCookies,
          cookiesFromBrowser: auth.cookiesFromBrowser
        }), { timeoutMs: remainingMs(), logger })
        const first = parseYtDlpSearch(result.stdout)[0]
        if (!first) throw Object.assign(new Error('yt-dlp não encontrou resultados para a pesquisa'), { errorType: 'NO_SEARCH_RESULTS' })
        return { ...mapYtDlpInfo({}, first), resolver: 'search', authMode: auth.mode, ytDlpVersion: engine.version }
      }
      const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
      const result = await runCaptured(engine.path, buildYtDlpInfoArgs({
        url,
        cookieFile: auth.cookieFile,
        useCookies: auth.useCookies,
        cookiesFromBrowser: auth.cookiesFromBrowser
      }), { timeoutMs: remainingMs(), logger })
      let info = {}
      try { info = JSON.parse(String(result.stdout || '').trim()) } catch {}
      if (!info?.id && !info?.webpage_url) throw Object.assign(new Error('yt-dlp não conseguiu ler os metadados do vídeo'), { errorType: 'VIDEO_UNAVAILABLE' })
      return { ...mapYtDlpInfo(info, { videoUrl: url }), resolver: 'url', authMode: auth.mode, ytDlpVersion: engine.version }
    } catch (cause) {
      lastError = classifyYtDlpError(cause)
      logger?.debug?.({ errorType: lastError.errorType, authMode: auth.mode, error: lastError.message }, 'resolução rápida do .play falhou')
    }
  }
  if (lastError) {
    lastError.cookieFile = cookieState.cookieFile
    lastError.cookieAvailable = cookieState.cookieAvailable
  }
  throw lastError || Object.assign(new Error('yt-dlp não conseguiu resolver a música'), { errorType: 'YTDLP_FAILED' })
}

export function classifyYtDlpError(error) {
  const text = `${error?.message || ''}\n${error?.stderr || ''}`.toLowerCase()
  const result = error instanceof Error ? error : new Error(String(error || 'Falha no yt-dlp'))
  if (/sign in|confirm you.re not a bot|login required|authentication/.test(text)) result.errorType = 'YTDLP_LOGIN_REQUIRED'
  else if (/video is unavailable|video unavailable|not available in your country|private video|removed by/.test(text)) result.errorType = 'VIDEO_UNAVAILABLE'
  else if (/http error 403|forbidden/.test(text)) { result.errorType = 'YTDLP_HTTP_403'; result.status = 403 }
  else if (/unsupported url/.test(text)) result.errorType = 'YTDLP_UNSUPPORTED_URL'
  else if (/downloaded file is empty|arquivo.*vazio|empty output/.test(text)) result.errorType = 'YTDLP_EMPTY_OUTPUT'
  else if (/signature solving failed|n challenge solving failed|javascript challenge|ejs/.test(text)) result.errorType = 'YTDLP_EJS_FAILED'
  else if (/timed? out|timeout/.test(text)) result.errorType = 'YTDLP_TIMEOUT'
  else if (!result.errorType) result.errorType = 'YTDLP_FAILED'
  return result
}

async function cleanupAttempt(outputBase) {
  const directory = path.dirname(outputBase)
  const prefix = `${path.basename(outputBase)}.`
  let names = []
  try { names = await fs.readdir(directory) } catch {}
  await Promise.all(names.filter(name => name.startsWith(prefix)).map(name => fs.rm(path.join(directory, name), { force: true })))
}

async function locateOutput(outputBase, stdout = '') {
  const printed = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse()
  for (const candidate of printed) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile() && stat.size >= 1024 && !candidate.endsWith('.json')) return candidate
    } catch {}
  }
  const directory = path.dirname(outputBase)
  const prefix = `${path.basename(outputBase)}.`
  const names = await fs.readdir(directory)
  for (const name of names) {
    if (!name.startsWith(prefix) || /\.(?:json|part|ytdl)$/i.test(name)) continue
    const candidate = path.join(directory, name)
    const stat = await fs.stat(candidate)
    if (stat.isFile() && stat.size >= 1024) return candidate
  }
  throw Object.assign(new Error('yt-dlp não produziu um arquivo de áudio válido'), { errorType: 'YTDLP_EMPTY_OUTPUT' })
}

export async function downloadWithYtDlp({ videoUrl, outputBase, fallback = {}, cookieFile = settings.youtubeCookieFile, deadline = 0, logger } = {}) {
  const engine = await ensureYtDlp({ autoInstall: true, logger })
  const hardDeadline = Math.min(deadline > Date.now() ? deadline : Number.POSITIVE_INFINITY, Date.now() + DOWNLOAD_TIMEOUT_MS)
  const remainingMs = (cap = DOWNLOAD_TIMEOUT_MS) => {
    const remaining = hardDeadline - Date.now()
    if (remaining <= 0) throw Object.assign(new Error('yt-dlp excedeu o limite total do .play'), { errorType: 'YTDLP_TIMEOUT' })
    return Math.max(3_000, Math.min(cap, remaining))
  }
  await fs.mkdir(path.dirname(outputBase), { recursive: true })

  const { attempts: authAttempts, cookieState } = authAttemptsFor(cookieFile)

  const isSearch = /^ytsearch\d*:/i.test(String(videoUrl || ''))
  let lastError

  for (const auth of authAttempts) {
    let candidates = [{ url: String(videoUrl || ''), ...fallback }]
    if (isSearch) {
      try {
        const searchArgs = buildYtDlpSearchArgs({
          query: videoUrl,
          cookieFile: auth.cookieFile,
          useCookies: auth.useCookies,
          cookiesFromBrowser: auth.cookiesFromBrowser
        })
        const searchResult = await runCaptured(engine.path, searchArgs, { timeoutMs: remainingMs(20_000), logger })
        candidates = parseYtDlpSearch(searchResult.stdout)
        if (!candidates.length) throw Object.assign(new Error('yt-dlp não encontrou resultados para a pesquisa'), { errorType: 'NO_SEARCH_RESULTS' })
      } catch (error) {
        lastError = classifyYtDlpError(error)
        logger?.debug?.({ errorType: lastError.errorType, authMode: auth.mode, error: lastError.message }, 'pesquisa do yt-dlp falhou')
        continue
      }
    }

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex]
      const directUrl = /^https?:\/\//i.test(String(candidate.url || ''))
        ? candidate.url
        : `https://www.youtube.com/watch?v=${candidate.id}`
      const anonymousClients = anonymousPlayerClients()
      const strategies = auth.mode === 'anônimo'
        ? [
            { name: 'm4a-padrão', formatMode: 'native-m4a', playerClients: '' },
            { name: 'audio-padrão', formatMode: 'native-any', playerClients: '' },
            { name: 'android-vr-fallback', formatMode: 'native-any', playerClients: anonymousClients.find(client => client === 'android_vr') || 'android_vr' }
          ]
        : [
            { name: 'm4a-autenticado', formatMode: 'native-m4a', playerClients: '' },
            { name: 'audio-autenticado', formatMode: 'native-any', playerClients: '' }
          ]

      for (const strategy of strategies) {
        await cleanupAttempt(outputBase)
        try {
          const args = buildYtDlpArgs({
            url: directUrl,
            outputBase,
            cookieFile: auth.cookieFile,
            useCookies: auth.useCookies,
            cookiesFromBrowser: auth.cookiesFromBrowser,
            formatMode: strategy.formatMode,
            playerClients: strategy.playerClients
          })
          const result = await runCaptured(engine.path, args, { timeoutMs: remainingMs(), logger })
          const outputPath = await locateOutput(outputBase, result.stdout)
          const stat = await fs.stat(outputPath)
          if (stat.size > 95 * 1024 * 1024) throw Object.assign(new Error('áudio do yt-dlp excede 95 MB'), { errorType: 'SOURCE_TOO_LARGE' })
          if (stat.size < 16 * 1024) throw Object.assign(new Error('yt-dlp produziu um arquivo de áudio vazio ou incompleto'), { errorType: 'YTDLP_EMPTY_OUTPUT' })
          let info = {}
          try { info = JSON.parse(await fs.readFile(`${outputBase}.info.json`, 'utf8')) } catch {}
          const metadata = mapYtDlpInfo(info, { ...fallback, ...candidate })
          const extension = path.extname(outputPath).slice(1).toLowerCase() || (strategy.formatMode === 'mp3' ? 'mp3' : 'm4a')
          const mimetype = extension === 'mp3' ? 'audio/mpeg'
            : extension === 'm4a' || extension === 'mp4' ? 'audio/mp4'
              : extension === 'webm' ? 'audio/webm'
                : extension === 'ogg' || extension === 'opus' ? 'audio/ogg; codecs=opus'
                  : 'audio/mpeg'
          logger?.success?.({ videoId: metadata.videoId, bytes: stat.size, version: engine.version, authMode: auth.mode, strategy: strategy.name, candidate: candidateIndex + 1 }, 'áudio baixado pelo motor yt-dlp')
          await fs.rm(`${outputBase}.info.json`, { force: true }).catch(() => {})
          return {
            ...metadata,
            filePath: outputPath,
            mimetype,
            extension,
            outputBytes: stat.size,
            ytDlpVersion: engine.version,
            authMode: auth.mode,
            searchFallbackIndex: candidateIndex
          }
        } catch (cause) {
          lastError = classifyYtDlpError(cause)
          logger?.debug?.({ errorType: lastError.errorType, authMode: auth.mode, strategy: strategy.name, candidate: candidateIndex + 1, error: lastError.message, stderr: String(lastError.stderr || '').slice(-1800) }, 'tentativa do yt-dlp falhou')
          if (lastError.errorType === 'YTDLP_LOGIN_REQUIRED' && auth.mode !== 'anônimo') break
        }
      }

      if (lastError?.errorType === 'YTDLP_LOGIN_REQUIRED' && auth.mode !== 'anônimo') break
    }

    if (lastError?.errorType === 'YTDLP_LOGIN_REQUIRED' && auth.mode !== 'anônimo' && cookieState.browserSources.length === 0) break
  }

  await cleanupAttempt(outputBase)
  if (lastError) {
    lastError.cookieFile = cookieState.cookieFile
    lastError.cookieAvailable = cookieState.cookieAvailable
    lastError.browserSources = cookieState.browserSources
  }
  throw lastError || Object.assign(new Error('yt-dlp não conseguiu baixar a música'), { errorType: 'YTDLP_FAILED' })
}

export async function getYtDlpHealth({ autoInstall = false, logger } = {}) {
  try {
    const state = await ensureYtDlp({ autoInstall, logger })
    return {
      available: Boolean(state.path),
      path: state.path || localBinaryPath(),
      version: state.version || '',
      source: state.source,
      autoInstall: bool(process.env.SAKURA_AUTO_INSTALL_YTDLP, true),
      supported: Boolean(resolveYtDlpReleaseAsset()),
      noCookies: bool(process.env.PLAY_NO_COOKIES, true),
      anonymousClients: anonymousPlayerClients(),
      proxyConfigured: Boolean(String(process.env.YTDLP_PROXY || '').trim()),
      cookies: getYtDlpCookieState()
    }
  } catch (error) {
    return {
      available: false,
      path: localBinaryPath(),
      version: '',
      source: 'error',
      autoInstall: bool(process.env.SAKURA_AUTO_INSTALL_YTDLP, true),
      supported: Boolean(resolveYtDlpReleaseAsset()),
      noCookies: bool(process.env.PLAY_NO_COOKIES, true),
      anonymousClients: anonymousPlayerClients(),
      proxyConfigured: Boolean(String(process.env.YTDLP_PROXY || '').trim()),
      cookies: getYtDlpCookieState(),
      error: error?.message || String(error)
    }
  }
}

export async function downloadGenericWithYtDlp({ url, outputBase, maxBytes = 95 * 1024 * 1024, logger } = {}) {
  const engine = await ensureYtDlp({ autoInstall: true, logger })
  await fs.mkdir(path.dirname(outputBase), { recursive: true })
  await cleanupAttempt(outputBase)
  const maxMb = Math.max(1, Math.floor(Number(maxBytes || 0) / 1024 / 1024))
  const args = [
    '--no-config', '--no-playlist', '--color', 'never', '--newline',
    '--socket-timeout', '12', '--retries', '1', '--fragment-retries', '2', '--extractor-retries', '1',
    '--concurrent-fragments', '8', '--no-part', '--no-mtime', '--no-write-playlist-metafiles',
    '--js-runtimes', `node:${process.execPath}`,
    '--cache-dir', path.join(settings.cacheDir, 'yt-dlp'),
    '--max-filesize', `${maxMb}M`,
    '--format', `bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best`,
    '--merge-output-format', 'mp4',
    '--write-info-json', '--clean-info-json',
    '--output', `${outputBase}.%(ext)s`,
    '--output', `infojson:${outputBase}.info.json`,
    '--print', 'after_move:filepath'
  ]
  appendFfmpegLocation(args, settings.ffmpegPath)
  appendNetworkOptions(args)
  args.push('--', String(url || ''))
  try {
    const result = await runCaptured(engine.path, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS, logger })
    const filePath = await locateOutput(outputBase, result.stdout)
    const stat = await fs.stat(filePath)
    if (stat.size > maxBytes) throw Object.assign(new Error('mídia excede o limite do AutoDownload'), { errorType: 'SOURCE_TOO_LARGE' })
    let info = {}
    try { info = JSON.parse(await fs.readFile(`${outputBase}.info.json`, 'utf8')) } catch {}
    await fs.rm(`${outputBase}.info.json`, { force: true }).catch(() => {})
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const vcodec = String(info.vcodec || '')
    const acodec = String(info.acodec || '')
    const kind = (!vcodec || vcodec === 'none') && acodec && acodec !== 'none' ? 'audio' : 'video'
    const mimetype = kind === 'audio'
      ? (ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : ext === 'ogg' || ext === 'opus' ? 'audio/ogg; codecs=opus' : 'audio/mpeg')
      : (ext === 'webm' ? 'video/webm' : 'video/mp4')
    return {
      filePath, kind, mimetype, bytes: stat.size,
      title: String(info.title || 'Mídia').slice(0, 180),
      author: String(info.uploader || info.channel || info.artist || '').slice(0, 120),
      webpageUrl: String(info.webpage_url || url || ''),
      ytDlpVersion: engine.version
    }
  } catch (error) {
    await cleanupAttempt(outputBase)
    throw classifyYtDlpError(error)
  }
}
