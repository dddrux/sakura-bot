import { defineCommand } from '../data/workstation.js'
import { consumeRecentStickerMedia, recentStickerMediaStats } from '../data/sticker-batch-cache.js'
import { downloadStickerSource, convertToSticker } from '../data/media.js'
import { enqueueMediaTask } from '../data/media-priority.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from '../data/sticker-metadata.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { getVipBenefits } from '../data/vip.js'
import { reply } from '../data/reply.js'
import { groupDisplayName } from '../data/user-display.js'

function requestedLimit(invokedAs = '', rawArgs = '') {
  const byAlias = String(invokedAs || '').match(/(5|10|15|20)$/)?.[1]
  const byArg = String(rawArgs || '').trim().match(/^\d+$/)?.[0]
  return Math.max(1, Math.min(20, Number(byArg || byAlias || 20)))
}

export default defineCommand({
  name: 's20',
  aliases: ['s5', 's10', 's15', 'figlote', 'stickerlote', 'figurinhaslote'],
  category: 'Mídia',
  usage: '.s20',
  description: 'Converte até 20 fotos recentes do próprio usuário em uma fila segura.',
  vipPreferred: true,

  async execute({ sock, msg, rawArgs, invokedAs, logger, settings, senderNumber, chatNumber, metadata }) {
    const limit = requestedLimit(invokedAs, rawArgs)
    const available = recentStickerMediaStats(chatNumber, senderNumber)
    if (!available.count) {
      return reply(sock, msg, `💮 envie de 1 a ${limit} fotos e depois use *${settings.prefix}${invokedAs || 's20'}*. As referências expiram em 10 minutos.`)
    }

    const items = consumeRecentStickerMedia(chatNumber, senderNumber, limit)
    const vipState = await getVipBenefits(senderNumber)
    const vip = vipState.active
    const maxMb = vip ? vipState.mediaLimitMb : Math.min(30, vipState.mediaLimitMb)
    const maxBytes = maxMb * 1024 * 1024
    const stickerGroupName = await groupDisplayName(sock, msg.key.remoteJid, metadata)
    await reply(sock, msg, `💮 preparando ${items.length} figurinha${items.length === 1 ? '' : 's'} em fila. Uma falha não cancela o restante.`)

    const result = await enqueueMediaTask(async () => {
      let completed = 0
      let failed = 0
      const errors = []
      for (const item of items) {
        try {
          const source = await downloadStickerSource(item.msg, logger)
          if (!source) throw new Error('mídia não pôde ser localizada')
          if (source.fileLength > maxBytes || source.buffer.length > maxBytes) throw new Error(`mídia acima de ${maxMb} MB`)
          const raw = await convertToSticker(source.buffer, source.kind, logger, {
            durationSec: vip ? 5 : 4,
            fps: vip ? 30 : 20,
            fit: 'cover',
            timeoutMs: 90_000
          })
          const sticker = addSakuraStickerMetadata(raw, {
            botName: settings.botName,
            botNumber: settings.botNumber,
            userName: msg.pushName || 'Usuário',
            userNumber: senderNumber,
            description: buildSakuraStickerDescription({ userName: msg.pushName || 'Usuário', groupName: stickerGroupName })
          })
          await sock.sendMessage(msg.key.remoteJid, { sticker })
          await saveStickerToLibrary(sticker, {
            source: 'batch', creator: senderNumber, chat: chatNumber,
            animated: source.kind !== 'image'
          })
          completed += 1
        } catch (error) {
          failed += 1
          errors.push(error?.message || 'falha desconhecida')
          logger?.warn?.({ error, messageId: item.id, sender: senderNumber, chat: chatNumber }, 'item do lote de figurinhas falhou')
        }
      }
      return { completed, failed, errors }
    }, { vip })

    const detail = result.failed ? `\n🌸 ${result.failed} falharam; as demais continuaram normalmente.` : ''
    return reply(sock, msg, `💮 lote concluído: *${result.completed}/${items.length}* figurinhas criadas.${detail}`, { quoted: false })
  }
})
