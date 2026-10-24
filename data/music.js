import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { settings } from './settings.js'
import { downloadWithYtDlp, getYtDlpHealth, resolveYtDlpMedia } from './player/yt-dlp-engine.js'

function cleanQuery(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function youtubeUrl(value = '') {
  const clean = cleanQuery(value)
  if (!clean) return ''
  if (/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(clean)) {
    return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
  }
  return ''
}

export async function warmMusicEngine(logger) {
  return getYtDlpHealth({ autoInstall: true, logger })
}

export async function resolveMusic(query, logger) {
  const clean = cleanQuery(query)
  if (!clean) throw Object.assign(new Error('Informe o nome da música ou um link do YouTube.'), { errorType: 'EMPTY_QUERY' })
  const startedAt = Date.now()
  const resolved = await resolveYtDlpMedia(youtubeUrl(clean) || clean, {
    deadline: Date.now() + 25_000,
    logger
  })
  logger?.info?.({
    stage: 'play-resolve',
    query: clean.slice(0, 120),
    videoId: resolved.videoId,
    durationMs: Date.now() - startedAt
  }, 'música resolvida antes do download')
  return {
    ...resolved,
    provider: 'yt-dlp',
    source: 'yt-dlp • YouTube',
    endpoint: 'yt-dlp',
    query: clean
  }
}

export async function searchMusic(query, logger) {
  return resolveMusic(query, logger)
}

export async function downloadResolvedMusic(resolved = {}, logger) {
  const videoUrl = String(resolved.videoUrl || '').trim()
  if (!videoUrl) throw Object.assign(new Error('Resultado do .play sem URL do YouTube.'), { errorType: 'VIDEO_UNAVAILABLE' })
  const outputBase = path.join(settings.tmpDir, 'play', `sakura-${randomUUID()}`)
  const startedAt = Date.now()
  const media = await downloadWithYtDlp({
    videoUrl,
    outputBase,
    fallback: resolved,
    deadline: Date.now() + 75_000,
    logger
  })
  logger?.info?.({
    stage: 'play-download',
    videoId: media.videoId || resolved.videoId,
    bytes: media.outputBytes,
    durationMs: Date.now() - startedAt
  }, 'download gerenciado do .play concluído')
  return {
    ...resolved,
    ...media,
    provider: 'yt-dlp',
    source: 'yt-dlp • YouTube',
    endpoint: 'yt-dlp',
    query: resolved.query || '',
    cleanup: [media.filePath].filter(Boolean)
  }
}

export async function getMusicPreview(query, logger) {
  return resolveMusic(query, logger)
}

export async function downloadMusicAudio(query, logger) {
  const resolved = await resolveMusic(query, logger)
  return downloadResolvedMusic(resolved, logger)
}
