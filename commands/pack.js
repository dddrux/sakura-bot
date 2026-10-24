import fs from 'node:fs/promises'
import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { buildRandomPack, countStickers } from '../data/sticker-pack.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

export default defineCommand({
  name: 'pack',
  aliases: ['pacote', 'figurinhas', 'figs'],
  category: 'Diversão',
  usage: '.pack [quantidade]',
  description: 'Envia um pacote aleatório com as figurinhas já recebidas.',
  menuEntries: [{
    name: 'pack',
    usage: '.pack 8',
    description: 'Pacote aleatório de figurinhas',
    menuGroup: 'Diversão'
  }],
  async execute({ sock, msg, args, logger, settings }) {
    const total = await countStickers()
    if (!total) {
      return reply(sock, msg, 'Ainda não tenho figurinhas salvas.', { title: 'PACK' })
    }

    const requested = Number(args?.[0])
    const size = Number.isFinite(requested)
      ? Math.max(3, Math.min(15, Math.floor(requested)))
      : Math.min(8, total)

    const picks = await buildRandomPack({ size })

    await reply(sock, msg, `*Pacote aleatório* — ${picks.length}/${total} figurinhas`, { title: 'PACK' })

    for (const file of picks) {
      try {
        const buffer = await fs.readFile(file)
        await sock.sendMessage(
          msg.key.remoteJid,
          { sticker: buffer },
          { quoted: msg }
        )
      } catch (error) {
        logger?.warn?.({ error, file }, 'falha ao enviar figurinha do pacote')
      }
      // pequena pausa pra não estourar rate limit do WhatsApp
      await sleep(350)
    }
  }
})
