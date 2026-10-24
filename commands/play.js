import { defineCommand } from '../data/workstation.js'
import fs from 'node:fs/promises'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'
import { getVipBenefits } from '../data/vip.js'
import { sendAudioMedia } from '../data/media-delivery.js'
import { downloadPlay, getPlayManagerState, resolvePlay } from '../data/play-manager.js'
import { summarizeMusicTitle } from '../data/music-title.js'

function cleanText(value = '') { return String(value || '').replace(/\s+/g, ' ').trim() }

export function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`
}

export function formatLikeCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count < 0) return 'não disponível'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.floor(count))
}

export function buildPlayCaption(media = {}) {
  const author = cleanText(media.artist || media.author || 'YouTube') || 'YouTube'
  const title = summarizeMusicTitle(media.track || media.title || 'Música', author)
  return formatMessage([
    `título: ${title}`,
    `autor: ${author.slice(0, 72)}`,
    `likes: ${formatLikeCount(media.likeCount)}`
  ].join('\n'), { title: 'PLAYER SAKURA', brandFooter: true })
}

async function sendPreview(sock, msg, media, logger) {
  const caption = buildPlayCaption(media)
  if (media.thumbnailUrl) {
    try {
      await sock.sendMessage(msg.key.remoteJid, { image: { url: media.thumbnailUrl }, caption }, { quoted: msg })
      return
    } catch (error) { logger?.debug?.({ error }, 'thumbnail do .play indisponível; usando card em texto') }
  }
  await sock.sendMessage(msg.key.remoteJid, { text: caption }, { quoted: msg })
}

async function sendAudio(sock, msg, media, logger) {
  if (!media.filePath) throw Object.assign(new Error('yt-dlp não gerou arquivo local'), { errorType: 'YTDLP_EMPTY_OUTPUT' })
  const extension = cleanText(media.extension) || 'm4a'
  const shortTitle = summarizeMusicTitle(media.track || media.title || 'musica', media.artist || media.author || '', 58)
  const fileName = `${shortTitle.replace(/[\\/:*?"<>|]/g, '').trim() || 'musica'}.${extension}`
  const audio = await fs.readFile(media.filePath)
  if (!audio.length) throw Object.assign(new Error('yt-dlp gerou áudio vazio'), { errorType: 'YTDLP_EMPTY_OUTPUT' })
  const sent = await sendAudioMedia(sock, msg, audio, {
    mimetype: media.mimetype || 'audio/mp4',
    ptt: false,
    fileName,
    quoted: false,
    retries: 2
  })
  logger?.success?.({ stage: 'play-audio-send', bytes: audio.length, fileName, cacheHit: Boolean(media.cacheHit) }, 'áudio do .play enviado ao WhatsApp')
  return sent
}

export default defineCommand({
  name: 'play',
  aliases: ['musica', 'música', 'tocar', 'music', 'song', 'mp3'],
  category: 'Mídia',
  usage: '.play nome da música ou link do YouTube',
  description: 'Busca rapidamente no YouTube, gerencia fila/cache e baixa o áudio com yt-dlp.',
  antifloodCost: 3,
  async execute({ sock, msg, rawArgs, logger, senderNumber }) {
    const query = String(rawArgs || '').trim()
    if (!query) return reply(sock, msg, 'Use: *.play artista - título* ou cole um link do YouTube.', { title: 'PLAYER SAKURA' })
    const vipState = await getVipBenefits(senderNumber)
    const vip = vipState.active
    const maxMb = vipState.mediaLimitMb
    const maxBytes = maxMb * 1024 * 1024
    const startedAt = Date.now()
    let resolved
    try {
      // Busca curta primeiro: o usuário recebe o card enquanto o áudio entra na fila/download.
      resolved = await resolvePlay(query, { logger })
      await sendPreview(sock, msg, resolved, logger).catch(error => logger?.debug?.({ error }, 'preview do .play não enviado'))

      const media = await downloadPlay(resolved, { vip, logger })
      const stat = await fs.stat(media.filePath)
      if (stat.size > maxBytes) throw Object.assign(new Error(`O áudio ultrapassa ${maxMb} MB.`), { errorType: 'PLAN_MEDIA_LIMIT' })
      await sendAudio(sock, msg, media, logger)
      logger?.success?.({
        stage: 'play-complete',
        videoId: media.videoId,
        durationMs: Date.now() - startedAt,
        cacheHit: Boolean(media.cacheHit),
        manager: getPlayManagerState()
      }, 'comando .play concluído pelo gerenciador')
    } catch (error) {
      logger?.warn?.({ error, query, videoId: resolved?.videoId, manager: getPlayManagerState() }, 'falha no comando play gerenciado')
      const type = String(error?.errorType || error?.code || '').toUpperCase()
      const message = type === 'PLAN_MEDIA_LIMIT' || type === 'SOURCE_TOO_LARGE'
        ? `💮 Esse áudio ultrapassa o limite de ${maxMb} MB do seu plano.`
        : type === 'YTDLP_LOGIN_REQUIRED' ? '💮 O YouTube pediu autenticação para esse vídeo. Configure cookies do YouTube e tente de novo.'
          : type === 'VIDEO_UNAVAILABLE' ? '💮 Esse vídeo não está disponível.'
            : type === 'YTDLP_TIMEOUT' ? '💮 O YouTube demorou demais. Tente novamente em alguns segundos.'
              : type === 'NO_SEARCH_RESULTS' ? '💮 Não encontrei essa música no YouTube.'
                : type === 'PRIORITY_QUEUE_FULL' ? '💮 A fila de músicas está cheia agora. Tente novamente em instantes.'
                  : `💮 Não consegui enviar essa música.${error?.message ? ` ${cleanText(error.message)}` : ''}`
      await reply(sock, msg, message)
    }
  }
})
