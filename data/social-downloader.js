import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { settings } from './settings.js'

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const PINTEREST_HOSTS = new Set(['pinterest.com', 'www.pinterest.com', 'br.pinterest.com', 'pin.it'])
const USER_AGENT = 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/126 Safari/537.36 Sakura-MD/1.0.6'
const HTML_LIMIT = 6 * 1024 * 1024

function hostOf(value = '') {
  try { return new URL(String(value || '').trim()).hostname.toLowerCase() } catch { return '' }
}

export function socialPlatform(value = '') {
  const host = hostOf(value)
  if (INSTAGRAM_HOSTS.has(host) || host.endsWith('.instagram.com')) return 'Instagram'
  if (PINTEREST_HOSTS.has(host) || host.endsWith('.pinterest.com')) return 'Pinterest'
  return ''
}

export function isSocialMediaUrl(value = '') {
  return Boolean(socialPlatform(value))
}

function decodeEntities(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 0))
}

function decodeEscapedUrl(value = '') {
  return decodeEntities(String(value || ''))
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\x26/gi, '&')
    .trim()
}

function sanitizeTitle(value = '', fallback = 'Mídia social') {
  return decodeEntities(String(value || fallback)).replace(/\s+/g, ' ').trim().slice(0, 180) || fallback
}

function extensionFrom(url, kind, mime = '') {
  const pathname = (() => { try { return new URL(url).pathname } catch { return '' } })()
  const ext = path.extname(pathname).toLowerCase().replace(/[^.a-z0-9]/g, '')
  if (kind === 'video' && ['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) return ext
  if (kind === 'image' && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext
  if (String(mime).includes('webm')) return '.webm'
  if (String(mime).includes('png')) return '.png'
  if (String(mime).includes('webp')) return '.webp'
  return kind === 'video' ? '.mp4' : '.jpg'
}

async function streamToFile(url, file, maxBytes, referer = '') {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'user-agent': USER_AGENT,
      accept: '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
      ...(referer ? { referer } : {})
    }
  })
  if (!response.ok || !response.body) throw new Error(`Download retornou HTTP ${response.status}`)
  const responseMime = String(response.headers.get('content-type') || '').toLowerCase()
  if (responseMime.startsWith('text/html') || responseMime.includes('application/json')) {
    throw new Error('O endereço retornou uma página em vez da mídia.')
  }
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxBytes) throw Object.assign(new Error('Mídia maior que o limite do plano.'), { code: 'SOCIAL_TOO_LARGE' })

  await fs.mkdir(path.dirname(file), { recursive: true })
  const handle = await fs.open(file, 'w')
  let total = 0
  try {
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      total += chunk.length
      if (total > maxBytes) throw Object.assign(new Error('Mídia maior que o limite do plano.'), { code: 'SOCIAL_TOO_LARGE' })
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
  return { bytes: total, mime: response.headers.get('content-type') || '' }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate'
    }
  })
  if (!response.ok || !response.body) throw new Error(`Página retornou HTTP ${response.status}`)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > HTML_LIMIT) break
    chunks.push(Buffer.from(value))
  }
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: response.url || url }
}

function metaMap(html = '') {
  const output = new Map()
  for (const match of String(html).matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0]
    const attrs = {}
    for (const attr of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs[attr[1].toLowerCase()] = decodeEntities(attr[3])
    const key = String(attrs.property || attrs.name || '').toLowerCase()
    if (key && attrs.content && !output.has(key)) output.set(key, attrs.content)
  }
  return output
}

function walkJson(value, output = []) {
  if (!value || output.length > 100) return output
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, output)
    return output
  }
  if (typeof value !== 'object') return output
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && /^(?:https?:)?\/\//i.test(item)) {
      const kind = /video|contenturl/i.test(key) && /\.mp4|video/i.test(item) ? 'video' : /image|display|thumbnail|url/i.test(key) ? 'image' : ''
      if (kind) output.push({ url: item.startsWith('//') ? `https:${item}` : item, kind })
    } else walkJson(item, output)
  }
  return output
}

function jsonLdCandidates(html = '') {
  const output = []
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walkJson(JSON.parse(match[1]), output) } catch {}
  }
  return output
}

function embeddedCandidates(html = '') {
  const output = []
  const patterns = [
    { kind: 'video', regex: /["'](?:video_url|videoUrl|contentUrl|content_url)["']\s*:\s*["']([^"']+)["']/gi },
    { kind: 'video', regex: /["']([^"']+\.mp4(?:\?[^"']*)?)["']/gi },
    { kind: 'image', regex: /["'](?:display_url|displayUrl|image_url|imageUrl|thumbnailUrl)["']\s*:\s*["']([^"']+)["']/gi }
  ]
  for (const { kind, regex } of patterns) {
    for (const match of String(html).matchAll(regex)) {
      const url = decodeEscapedUrl(match[1])
      if (/^https?:\/\//i.test(url)) output.push({ url, kind })
    }
  }
  return output
}

function uniqueCandidates(values = []) {
  const seen = new Set()
  return values.filter(item => {
    const url = decodeEscapedUrl(item?.url)
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return false
    seen.add(url)
    item.url = url
    return true
  })
}

function instagramVariants(url) {
  try {
    const parsed = new URL(url)
    const cleanPath = parsed.pathname.replace(/\/+$/, '')
    const variants = [`https://www.instagram.com${cleanPath}/`]
    if (/\/(?:reel|reels|p|tv)\//i.test(cleanPath)) variants.push(`https://www.instagram.com${cleanPath}/embed/captioned/`)
    return [...new Set(variants)]
  } catch {
    return [url]
  }
}

async function resolveDirectMedia(url, platform) {
  const variants = platform === 'Instagram' ? instagramVariants(url) : [url]
  let lastError
  for (const variant of variants) {
    try {
      const { html, finalUrl } = await fetchHtml(variant)
      const meta = metaMap(html)
      const candidates = uniqueCandidates([
        ...(meta.get('og:video:secure_url') ? [{ url: meta.get('og:video:secure_url'), kind: 'video' }] : []),
        ...(meta.get('og:video') ? [{ url: meta.get('og:video'), kind: 'video' }] : []),
        ...(meta.get('twitter:player:stream') ? [{ url: meta.get('twitter:player:stream'), kind: 'video' }] : []),
        ...jsonLdCandidates(html),
        ...embeddedCandidates(html),
        ...(meta.get('og:image:secure_url') ? [{ url: meta.get('og:image:secure_url'), kind: 'image' }] : []),
        ...(meta.get('og:image') ? [{ url: meta.get('og:image'), kind: 'image' }] : [])
      ])
      const chosen = candidates.find(item => item.kind === 'video') || candidates.find(item => item.kind === 'image')
      if (!chosen) throw new Error('A página não expôs uma mídia pública para download.')
      return {
        ...chosen,
        finalUrl,
        title: sanitizeTitle(meta.get('og:title') || meta.get('twitter:title'), `${platform} download`),
        author: sanitizeTitle(meta.get('og:site_name'), platform).slice(0, 80)
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Não foi possível localizar a mídia pública.')
}

async function tryDirect(url, platform, maxBytes) {
  const resolved = await resolveDirectMedia(url, platform)
  const provisionalExt = extensionFrom(resolved.url, resolved.kind)
  const filePath = path.join(settings.tmpDir, `social-${randomUUID()}${provisionalExt}`)
  try {
    const downloaded = await streamToFile(resolved.url, filePath, maxBytes, resolved.finalUrl)
    const ext = extensionFrom(resolved.url, resolved.kind, downloaded.mime)
    let finalPath = filePath
    if (path.extname(filePath) !== ext) {
      finalPath = filePath.slice(0, -path.extname(filePath).length) + ext
      await fs.rename(filePath, finalPath)
    }
    return {
      platform,
      kind: resolved.kind,
      filePath: finalPath,
      bytes: downloaded.bytes,
      title: resolved.title,
      author: resolved.author,
      mimetype: resolved.kind === 'video'
        ? (downloaded.mime || 'video/mp4').split(';')[0]
        : (downloaded.mime || 'image/jpeg').split(';')[0],
      cleanup: [finalPath],
      engine: 'direct-public'
    }
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => {})
    throw error
  }
}

export async function downloadSocialMedia(url, { maxBytes = 48 * 1024 * 1024 } = {}) {
  const platform = socialPlatform(url)
  if (!platform) throw new TypeError('Link do Instagram ou Pinterest inválido.')
  return tryDirect(url, platform, maxBytes)
}
