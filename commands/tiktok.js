import { defineCommand } from '../data/workstation.js'
import fs from 'node:fs/promises'
import { downloadTikTok, isTikTokUrl } from '../data/tiktok.js'
import { getVipBenefits } from '../data/vip.js'
import { reply } from '../data/reply.js'
import { enqueueMediaTask } from '../data/media-priority.js'
import { formatMessage } from '../data/formatter.js'

export default defineCommand({
  name: 'tiktok',
  aliases: ['tt', 'tkv'],
  category: 'Mídia',
  usage: '.tt link_do_tiktok',
  description: 'Baixa vídeo do TikTok sem cookies.',
  async execute({ sock, msg, rawArgs, senderNumber, logger }) {
    const url = String(rawArgs || '').trim().split(/\s+/, 1)[0]
    if (!isTikTokUrl(url)) return reply(sock, msg, 'Envie um link válido do TikTok.\nExemplo: .tt https://www.tiktok.com/...', { title: 'TIKTOK' })

    const vipState = await getVipBenefits(senderNumber)
    const vip = vipState.active
    const maxMb = vipState.mediaLimitMb
    await sock.sendMessage(msg.key.remoteJid, { react: { text: '💮', key: msg.key } }).catch(() => {})
    let result
    try {
      result = await enqueueMediaTask(() => downloadTikTok(url, { maxBytes: maxMb * 1024 * 1024 }), { vip })
      await sock.sendMessage(msg.key.remoteJid, {
        video: { url: result.filePath },
        mimetype: 'video/mp4',
        caption: formatMessage(`título: ${result.title}\nautor: ${result.author}\nplano: ${vipState.planName}\nlimite: ${maxMb} MB`, { title: 'TIKTOK' })
      }, { quoted: msg })
      await sock.sendMessage(msg.key.remoteJid, { react: { text: '💮', key: msg.key } }).catch(() => {})
    } catch (error) {
      logger?.warn?.({ error, url, vip }, 'falha no downloader do TikTok')
      await sock.sendMessage(msg.key.remoteJid, { react: { text: '🌸', key: msg.key } }).catch(() => {})
      const message = error?.code === 'TIKTOK_TOO_LARGE'
        ? `O vídeo ultrapassa o limite de ${maxMb} MB do seu plano.`
        : 'Não consegui baixar esse vídeo agora. O link pode estar privado, removido ou indisponível.'
      await reply(sock, msg, message, { title: 'TIKTOK' })
    } finally {
      if (result?.cleanup) await Promise.all(result.cleanup.map(file => fs.rm(file, { force: true }).catch(() => {})))
    }
  }
})
