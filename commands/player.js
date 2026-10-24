import { defineCommand } from '../data/workstation.js'
import { requestMedia } from '../data/media-process-client.js'
import { reply } from '../data/reply.js'

const mb = bytes => Number(bytes || 0) > 0 ? `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB` : 'não informado'

export default defineCommand({
  name: 'player', aliases: ['playstatus', 'playdebug'], category: 'Dono', ownerOnly: true,
  usage: '.player [status|teste <música ou link>]',
  description: 'Mostra o estado do motor yt-dlp ou executa um teste real.',
  async execute({ sock, msg, rawArgs, logger }) {
    const [action = 'status', ...rest] = String(rawArgs || '').trim().split(/\s+/)
    if (['teste','test','testar'].includes(action.toLowerCase())) {
      const query = rest.join(' ').trim()
      if (!query) return reply(sock, msg, 'Use: *.player teste artista - título* ou um link do YouTube.', { title: 'PLAYER YT-DLP' })
      let media
      try {
        const startedAt = Date.now()
        media = await requestMedia('play', { query }, { timeoutMs: 100_000 })
        return reply(sock, msg, [
          `resultado: ${media.title || 'Música'}`,
          `artista/canal: ${media.author || 'YouTube'}`,
          'motor: yt-dlp',
          `versão: ${media.ytDlpVersion || 'detectada em runtime'}`,
          `formato: ${media.extension || media.mimetype || 'áudio'}`,
          `tamanho: ${mb(media.outputBytes)}`,
          `tempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
        ].join('\n'), { title: 'TESTE YT-DLP' })
      } catch (error) {
        logger?.warn?.({ error, query }, 'teste manual do yt-dlp falhou')
        return reply(sock, msg, `falha: ${error?.message || error}\ntipo: ${error?.errorType || error?.code || 'desconhecido'}`, { title: 'TESTE YT-DLP' })
      } finally {
        if (media?.cleanup?.length) {
          const fs = await import('node:fs/promises')
          await Promise.all(media.cleanup.map(file => fs.rm(file, { force: true }).catch(() => {})))
        }
      }
    }
    const state = await requestMedia('player-health', {}, { timeoutMs: 30_000 })
    return reply(sock, msg, [
      'motor: yt-dlp',
      `disponível: ${state.available ? 'sim' : 'não'}`,
      `versão: ${state.version || 'não detectada'}`,
      `origem: ${state.source || 'runtime'}`,
      `binário: ${state.path || 'não localizado'}`,
      `fragmentos paralelos: 8`,
      `cookies: ${state.cookies?.cookieAvailable ? 'arquivo disponível' : 'opcionais'}`,
      '',
      'Teste real: *.player teste nome da música*'
    ].join('\n'), { title: 'PLAYER YT-DLP' })
  }
})
