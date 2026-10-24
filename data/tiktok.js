import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { settings } from './settings.js'

const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'])

export function isTikTokUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim())
    return TIKTOK_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith('.tiktok.com')
  } catch { return false }
}

async function fetchJson(url, timeoutMs = 20_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'Mozilla/5.0 Sakura-MD/0.33' }
  })
  if (!response.ok) throw new Error(`TikTok API retornou HTTP ${response.status}`)
  return response.json()
}

async function streamToFile(url, file, maxBytes) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.tiktok.com/' }
  })
  if (!response.ok || !response.body) throw new Error(`Download do TikTok retornou HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxBytes) throw Object.assign(new Error('Vídeo maior que o limite do plano.'), { code: 'TIKTOK_TOO_LARGE' })

  await fs.mkdir(path.dirname(file), { recursive: true })
  const handle = await fs.open(file, 'w')
  let total = 0
  try {
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      total += chunk.length
      if (total > maxBytes) throw Object.assign(new Error('Vídeo maior que o limite do plano.'), { code: 'TIKTOK_TOO_LARGE' })
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
  return total
}

export async function downloadTikTok(url, { maxBytes = 48 * 1024 * 1024 } = {}) {
  if (!isTikTokUrl(url)) throw new TypeError('Link do TikTok inválido')
  const payload = await fetchJson(`https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`)
  const data = payload?.data || {}
  const videoUrl = data.hdplay || data.play || data.wmplay
  if (!videoUrl) throw new Error(payload?.msg || 'O TikTok não retornou o vídeo')
  const filePath = path.join(settings.tmpDir, `tiktok-${randomUUID()}.mp4`)
  const bytes = await streamToFile(videoUrl, filePath, maxBytes)
  return {
    filePath,
    bytes,
    title: String(data.title || 'Vídeo do TikTok').trim().slice(0, 180),
    author: String(data.author?.nickname || data.author?.unique_id || 'TikTok').trim().slice(0, 80),
    duration: Number(data.duration || 0),
    cleanup: [filePath]
  }
}
