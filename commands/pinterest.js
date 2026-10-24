import { defineCommand } from '../data/workstation.js'
import { searchPinterestImages, downloadPinterestImage } from '../data/pinterest-search.js'
import { convertToSticker } from '../data/media.js'
import { addExactStickerMetadata } from '../data/sticker-metadata.js'
import { sendStickerMedia } from '../data/media-delivery.js'
import { sendMessageFast } from '../data/send-manager.js'
import { enqueueMediaTask } from '../data/media-priority.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { reply } from '../data/reply.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

function isPinfig(invokedAs = '', text = '', prefix = '.') {
  const invoked = String(invokedAs || '').toLowerCase().trim()
  if (invoked) return invoked === 'pinfig'
  return String(text || '').trim().toLowerCase().startsWith(`${prefix}pinfig`)
}

async function sendFiveImages({ sock, msg, query, logger }) {
  const candidates = await searchPinterestImages(query, { limit: 12, maxPages: 2 })
  let sent = 0
  for (const candidate of candidates) {
    if (sent >= 5) break
    try {
      const image = await enqueueMediaTask(() => downloadPinterestImage(candidate.url), { vip: true })
      await sendMessageFast(sock, msg.key.remoteJid, {
        image,
        ...(sent === 0 ? { caption: `🌸 Pinterest • ${query}\n5 imagens selecionadas` } : {})
      }, sent === 0 ? { quoted: msg } : {}, { priority: 'vip', retries: 2 })
      sent += 1
    } catch (error) {
      logger?.debug?.({ error, stage: 'pin-image', url: candidate.url }, 'imagem Pinterest ignorada')
    }
  }
  if (sent < 5) throw new Error(`Pinterest conseguiu entregar apenas ${sent}/5 imagens.`)
  return sent
}

async function sendStickerPack({ sock, msg, query, senderNumber, chatNumber, logger }) {
  const desired = 50
  const candidates = await searchPinterestImages(query, { limit: 70, maxPages: 5 })
  let sent = 0
  let attempted = 0
  for (const candidate of candidates) {
    if (sent >= desired) break
    attempted += 1
    try {
      const sticker = await enqueueMediaTask(async () => {
        const image = await downloadPinterestImage(candidate.url)
        const raw = await convertToSticker(image, 'image', logger, { fit: 'cover' })
        return addExactStickerMetadata(raw, {
          packName: `Pinterest • ${query}`.slice(0, 80),
          publisher: 'drux domina',
          emojis: []
        })
      }, { vip: true })
      await sendStickerMedia(sock, msg, sticker, { quoted: sent === 0 ? msg : false, priority: 'vip', retries: 2 })
      await saveStickerToLibrary(sticker, { source: 'pinfig', creator: senderNumber, chat: chatNumber, animated: false, query })
      sent += 1
      if (sent < desired) await sleep(220)
    } catch (error) {
      logger?.debug?.({ error, stage: 'pinfig-sticker', attempted, sent, url: candidate.url }, 'imagem do pack Pinterest ignorada')
    }
  }
  if (!sent) throw new Error('Não foi possível montar nenhuma figurinha do Pinterest.')
  if (sent < desired) {
    await reply(sock, msg, `🌸 Pack concluído parcialmente: ${sent}/${desired} figurinhas válidas.`, { raw: true, quoted: false })
  }
  return { sent, desired, attempted }
}

export default defineCommand({
  name: 'pin',
  aliases: ['pinfig'],
  category: 'Mídia',
  usage: '.pin foto do gojo',
  description: 'VIP: busca imagens no Pinterest sem token; .pinfig cria um pack de até 50 figurinhas.',
  vipOnly: true,
  priority: 'vip',
  menuEntries: [
    { name: 'pin', usage: '.pin foto do gojo', description: 'VIP • mostra 5 imagens do Pinterest', menuGroup: 'Pinterest' },
    { name: 'pinfig', usage: '.pinfig gojo', description: 'VIP • cria até 50 figurinhas do Pinterest', menuGroup: 'Pinterest' }
  ],
  async execute({ sock, msg, rawArgs, invokedAs, text, settings, senderNumber, chatNumber, logger }) {
    const query = clean(rawArgs)
    if (!query) return reply(sock, msg, `🌸 Use ${settings.prefix}pin foto do gojo ou ${settings.prefix}pinfig gojo.`)
    const packMode = isPinfig(invokedAs, text, settings.prefix)
    try {
      if (packMode) return await sendStickerPack({ sock, msg, query, senderNumber, chatNumber, logger })
      return await sendFiveImages({ sock, msg, query, logger })
    } catch (error) {
      logger?.warn?.({ error, stage: packMode ? 'pinfig' : 'pin', query }, 'Pinterest sem token falhou')
      return reply(sock, msg, `🌸 Não consegui buscar no Pinterest agora: ${String(error?.message || 'erro temporário').slice(0, 140)}`)
    }
  }
})
