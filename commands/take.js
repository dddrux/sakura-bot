import { defineCommand } from '../data/workstation.js'
import { downloadStickerSource, convertToSticker } from '../data/media.js'
import { reply } from '../data/reply.js'
import { addExactStickerMetadata, stripStickerMetadata } from '../data/sticker-metadata.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { sendStickerMedia } from '../data/media-delivery.js'

function cleanName(value = '') {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export default defineCommand({
  name: 'take',
  aliases: ['roubarfig', 'wm'],
  category: 'Mídia',
  usage: '.take [nome da figurinha]',
  description: 'VIP: limpa os metadados da figurinha ou aplica um nome único.',
  vipOnly: true,
  async execute({ sock, msg, rawArgs, logger, senderNumber, chatNumber, isVip: vipAccess }) {
    if (!vipAccess) return reply(sock, msg, '💎 `.take` é exclusivo para VIP.')

    const source = await downloadStickerSource(msg, logger)
    if (!source) return reply(sock, msg, '💮 responda uma figurinha, foto ou vídeo')

    const raw = source.kind === 'sticker' ? source.buffer : await convertToSticker(source.buffer, source.kind, logger)
    const cleanSticker = stripStickerMetadata(raw)
    const customName = cleanName(rawArgs)
    const sticker = customName
      ? addExactStickerMetadata(cleanSticker, { packName: customName, publisher: '', emojis: [] })
      : cleanSticker

    await sendStickerMedia(sock, msg, sticker)
    await saveStickerToLibrary(sticker, {
      source: customName ? 'take-named' : 'take-clean',
      creator: senderNumber,
      chat: chatNumber,
      animated: source.animated,
      name: customName
    })
  }
})
