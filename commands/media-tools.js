import { defineCommand } from '../data/workstation.js'
import { transcodeQuotedMedia } from '../data/media-tools.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { getVipBenefits } from '../data/vip.js'

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

async function panel({ sock, msg, settings, logger }) {
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'media-tools',
    body: formatMessage('Responda à mídia e escolha a conversão desejada.', { title: 'ESTÚDIO DE MÍDIA' }),
    buttonText: '🌸 Converter mídia',
    sections: [
      { title: '🌸 Áudio', rows: [
        { id: `${settings.prefix}toaudio`, title: '🌸 Para áudio', description: 'Converte para OGG/Opus' },
        { id: `${settings.prefix}tomp3`, title: '🌸 Para MP3', description: 'Converte para MP3 192 kbps' }
      ] },
      { title: '🌸 Vídeo', rows: [
        { id: `${settings.prefix}tovideo`, title: '🌸 Para vídeo', description: 'Normaliza para MP4' },
        { id: `${settings.prefix}togif`, title: '💮 GIF animado', description: 'Envia como vídeo em loop' }
      ] }
    ]
  })
}

export default defineCommand({
  name: 'midia',
  aliases: ['media', 'ferramentasmidia', 'toaudio', 'tomp3', 'tovideo', 'togif'],
  category: 'Mídia',
  usage: '.midia',
  description: 'Conversões rápidas de mídia com limites Free/VIP.',
  vipPreferred: true,
  menuEntries: [
    { name: 'midia', usage: '.midia', description: 'Abre o estúdio de mídia.', menuGroup: 'Ferramentas' },
    { name: 'toaudio', usage: '.toaudio (respondendo mídia)', description: 'Converte para áudio.', menuGroup: 'Conversão' },
    { name: 'tomp3', usage: '.tomp3 (respondendo mídia)', description: 'Converte para MP3.', menuGroup: 'Conversão' },
    { name: 'tovideo', usage: '.tovideo (respondendo mídia)', description: 'Converte para MP4.', menuGroup: 'Conversão' },
    { name: 'togif', usage: '.togif (respondendo mídia)', description: 'Converte para GIF/vídeo em loop.', menuGroup: 'Conversão' }
  ],
  async execute({ sock, msg, invokedAs, settings, senderNumber, logger }) {
    const used = norm(invokedAs)
    if (['midia', 'media', 'ferramentasmidia'].includes(used)) return panel({ sock, msg, settings, logger })

    const mode = used === 'toaudio' ? 'audio' : used === 'tomp3' ? 'mp3' : used === 'togif' ? 'gif' : 'video'
    const vipState = await getVipBenefits(senderNumber)
    const maxMb = vipState.mediaLimitMb
    try {
      const out = await transcodeQuotedMedia(msg, mode, { logger, maxBytes: maxMb * 1024 * 1024 })
      if (mode === 'audio') return sock.sendMessage(msg.key.remoteJid, { audio: out.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: false }, { quoted: msg })
      if (mode === 'mp3') return sock.sendMessage(msg.key.remoteJid, { audio: out.buffer, mimetype: 'audio/mpeg', ptt: false, fileName: 'sakura.mp3' }, { quoted: msg })
      return sock.sendMessage(msg.key.remoteJid, {
        video: out.buffer,
        mimetype: 'video/mp4',
        gifPlayback: mode === 'gif',
        caption: formatMessage(`conversão: ${mode === 'gif' ? 'GIF/vídeo em loop' : 'vídeo MP4'}\nplano: ${vipState.planName}\nlimite: ${maxMb} MB`, { title: 'ESTÚDIO DE MÍDIA' })
      }, { quoted: msg })
    } catch (error) {
      return reply(sock, msg, error.message, { title: 'ESTÚDIO DE MÍDIA' })
    }
  }
})
