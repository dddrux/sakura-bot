import { defineCommand } from '../data/workstation.js'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { getMediaKind, getMediaTarget } from '../data/messages.js'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'
import { convertStickerToImage, convertStickerToVideo } from '../data/sticker-convert.js'
import { prepareLegacyAudio } from '../data/legacy-audio.js'
import { settings } from '../data/settings.js'
import path from 'node:path'


async function playWaitAudio(sock, msg, logger) {
  try {
    const file = path.join(settings.audioDir, 'legacy', 'aguarde.mp3')
    const audio = await prepareLegacyAudio(file, logger)
    await sock.sendMessage(msg.key.remoteJid, { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: msg })
  } catch (error) {
    logger?.debug?.({ error }, 'áudio aguarde um momento não pôde ser enviado')
  }
}

async function downloadTarget(msg, logger) {
  const target = getMediaTarget(msg)
  if (!target) return null
  const kind = getMediaKind(target.message)
  if (!['sticker', 'image', 'video'].includes(kind)) return null
  const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger })
  return { target, kind, buffer }
}

export default defineCommand({
  name: 'toimg',
  aliases: ['toimage', 'stickerimg', 'tovid', 'tomp4', 'stickervideo'],
  menuEntries: [
    { name: 'toimg', usage: '.toimg', description: 'Transforma figurinha em imagem.', menuGroup: 'Figurinhas' },
    { name: 'tomp4', usage: '.tomp4', description: 'Converte figurinha animada em MP4.', menuGroup: 'Figurinhas' }
  ],
  category: 'Mídia',
  usage: '.toimg ou .tomp4 respondendo uma figurinha',
  description: 'Converte figurinhas para imagem ou vídeo com fallbacks de compatibilidade.',

  async execute({ sock, msg, invokedAs, logger }) {
    const used = String(invokedAs || '').toLowerCase()
    const mode = ['tovideo', 'tovid', 'tomp4', 'stickervideo'].includes(used) ? 'video' : 'image'
    const source = await downloadTarget(msg, logger)
    if (!source) return reply(sock, msg, `Responda uma figurinha com *${mode === 'video' ? '.tomp4' : '.toimg'}*.`)

    if (mode === 'video' && source.kind === 'image') {
      return reply(sock, msg, 'Para criar MP4, responda uma figurinha, GIF ou vídeo.')
    }

    await playWaitAudio(sock, msg, logger)

    try {
      if (mode === 'image') {
        const out = await convertStickerToImage(source.buffer, logger)
        return sock.sendMessage(msg.key.remoteJid, {
          image: out.buffer,
          mimetype: out.mimetype,
          fileName: out.fileName,
          caption: formatMessage(`conversão concluída\nmodo: imagem\nrenderizador: ${out.renderer}`, { title: 'CONVERSOR' })
        }, { quoted: false })
      }

      const out = await convertStickerToVideo(source.buffer, logger)
      return sock.sendMessage(msg.key.remoteJid, {
        video: out.buffer,
        mimetype: out.mimetype,
        fileName: out.fileName,
        caption: formatMessage(`conversão concluída\nmodo: MP4\nencoder: ${out.encoder}`, { title: 'CONVERSOR' })
      }, { quoted: false })
    } catch (error) {
      logger?.warn?.({ error, command: mode === 'video' ? 'tomp4' : 'toimg' }, 'falha recuperável no conversor de figurinha')
      return reply(sock, msg, error.message || 'Não consegui converter essa figurinha.', { title: 'CONVERSOR' })
    }
  }
})
