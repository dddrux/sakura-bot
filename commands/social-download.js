import { defineCommand } from '../data/workstation.js'
import fs from 'node:fs/promises'
import { downloadSocialMedia, isSocialMediaUrl, socialPlatform } from '../data/social-downloader.js'
import { getVipBenefits } from '../data/vip.js'
import { reply } from '../data/reply.js'
import { enqueueMediaTask } from '../data/media-priority.js'
import { formatMessage } from '../data/formatter.js'

function caption(result, vipState, maxMb) {
  return formatMessage([
    `título: ${result.title}`,
    `autor: ${result.author || result.platform}`,
    `origem: ${result.platform}`,
    `plano: ${vipState.planName}`,
    `limite: ${maxMb} MB`
  ].join('\n'), { title: 'DOWNLOAD SOCIAL' })
}

export default defineCommand({
  name: 'socialdl',
  aliases: ['instagram', 'insta', 'ig', 'pinterest'],
  menuEntries: [
    { name: 'instagram', usage: '.instagram link', description: 'Baixa Reels e vídeos públicos do Instagram.', menuGroup: 'Downloads' },
    { name: 'pinterest', usage: '.pinterest link', description: 'Baixa vídeos ou imagens públicas do Pinterest.', menuGroup: 'Downloads' }
  ],
  category: 'Mídia',
  usage: '.instagram link ou .pinterest link',
  description: 'Baixa mídia pública do Instagram e Pinterest diretamente, sem yt-dlp.',
  async execute({ sock, msg, rawArgs, senderNumber, logger, invokedAs }) {
    const url = String(rawArgs || '').trim().split(/\s+/, 1)[0]
    if (!isSocialMediaUrl(url)) {
      const expected = ['pinterest'].includes(String(invokedAs || '').toLowerCase()) ? 'Pinterest' : 'Instagram ou Pinterest'
      return reply(sock, msg, `Envie um link público válido do ${expected}.\nExemplo: *.${invokedAs || 'instagram'} https://...*`, { title: 'DOWNLOAD SOCIAL' })
    }

    const vipState = await getVipBenefits(senderNumber)
    const vip = vipState.active
    const maxMb = vipState.mediaLimitMb
    const platform = socialPlatform(url)
    await sock.sendMessage(msg.key.remoteJid, { react: { text: '💮', key: msg.key } }).catch(() => {})
    let result
    try {
      result = await enqueueMediaTask(() => downloadSocialMedia(url, { maxBytes: maxMb * 1024 * 1024 }), { vip })
      const safeMime = result.kind === 'image'
        ? (String(result.mimetype || '').startsWith('image/') ? result.mimetype : 'image/jpeg')
        : (String(result.mimetype || '').startsWith('video/') ? result.mimetype : 'video/mp4')
      const content = result.kind === 'image'
        ? { image: { url: result.filePath }, mimetype: safeMime, caption: caption(result, vipState, maxMb) }
        : { video: { url: result.filePath }, mimetype: safeMime, caption: caption(result, vipState, maxMb) }
      await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg })
      await sock.sendMessage(msg.key.remoteJid, { react: { text: '💮', key: msg.key } }).catch(() => {})
    } catch (error) {
      logger?.warn?.({ error, url, platform, vip }, 'falha no downloader social')
      await sock.sendMessage(msg.key.remoteJid, { react: { text: '🌸', key: msg.key } }).catch(() => {})
      const message = error?.code === 'SOCIAL_TOO_LARGE'
        ? `A mídia ultrapassa o limite de ${maxMb} MB do seu plano.`
        : `Não consegui baixar esse conteúdo do ${platform || 'site'} agora. Links privados, stories e posts que exigem login não podem ser baixados pelo modo público direto.`
      await reply(sock, msg, message, { title: 'DOWNLOAD SOCIAL' })
    } finally {
      if (result?.cleanup) await Promise.all(result.cleanup.map(file => fs.rm(file, { recursive: true, force: true }).catch(() => {})))
    }
  }
})
