import { defineCommand } from '../data/workstation.js'
import { downloadStickerSource, convertToSticker } from '../data/media.js'
import { reply } from '../data/reply.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from '../data/sticker-metadata.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { sendStickerMedia } from '../data/media-delivery.js'
import { groupDisplayName } from '../data/user-display.js'

export default defineCommand({
  name: 's',
  aliases: ['sticker', 'fig', 'figurinha'],
  category: 'Mídia',
  usage: '.s',

  async execute({ sock, msg, logger, settings, senderNumber, chatNumber, metadata }) {
    const source = await downloadStickerSource(msg, logger)
    if (!source) return reply(sock, msg, '💮 envie ou responda uma foto/vídeo com .s')
    const rawSticker = await convertToSticker(source.buffer, source.kind, logger)
    const sticker = addSakuraStickerMetadata(rawSticker, {
      botName: settings.botName,
      botNumber: settings.botNumber,
      userName: msg.pushName || 'Usuário',
      userNumber: senderNumber,
      description: buildSakuraStickerDescription({
        userName: msg.pushName || 'Usuário',
        groupName: await groupDisplayName(sock, msg.key.remoteJid, metadata)
      })
    })
    await sendStickerMedia(sock, msg, sticker)
    await saveStickerToLibrary(sticker, { source: 'single', creator: senderNumber, chat: chatNumber, animated: source.kind !== 'image' })
  }
})
