import { defineCommand } from '../data/workstation.js'
import { getRandomSticker, stickerLibraryStatus } from '../data/sticker-library.js'
import { reply } from '../data/reply.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from '../data/sticker-metadata.js'
import { groupDisplayName } from '../data/user-display.js'

export default defineCommand({
  name: 'figsorteio',
  aliases: ['sortearfig', 'figaleatoria', 'stickeraleatorio'],
  category: 'Mídia',
  usage: '.figsorteio',
  description: 'Sorteia uma figurinha válida da biblioteca controlada.',

  async execute({ sock, msg, metadata }) {
    const status = await stickerLibraryStatus()
    if (!status.enabled) return reply(sock, msg, '💮 a biblioteca de figurinhas está desativada pelo dono.')
    const selected = await getRandomSticker()
    if (!selected) return reply(sock, msg, '💮 a biblioteca ainda não possui figurinhas válidas.')
    const groupName = await groupDisplayName(sock, msg.key.remoteJid, metadata)
    const sticker = addSakuraStickerMetadata(selected.buffer, {
      userName: msg.pushName || 'Usuário',
      description: buildSakuraStickerDescription({ userName: msg.pushName || 'Usuário', groupName })
    })
    await sock.sendMessage(msg.key.remoteJid, { sticker }, { quoted: msg })
  }
})
