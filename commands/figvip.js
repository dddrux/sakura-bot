import { defineCommand } from '../data/workstation.js'
import { downloadStickerSource, convertToSticker, convertVipAnimatedSticker } from '../data/media.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from '../data/sticker-metadata.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { enqueueMediaTask } from '../data/media-priority.js'
import { getVipBenefits } from '../data/vip.js'
import { reply } from '../data/reply.js'
import { sendStickerMedia } from '../data/media-delivery.js'
import { groupDisplayName } from '../data/user-display.js'

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function resolveMode(invokedAs = '', args = []) {
  const invoked = normalize(invokedAs)
  const aliases = {
    figqualidade: 'qualidade', figultra: 'qualidade',
    figsemcorte: 'semcorte', fignocrop: 'semcorte',
    figquadrada: 'quadrada',
    figredonda: 'redonda',
    figborda: 'borda',
    figtexto: 'texto',
    figanim: 'animada', fig60: 'animada', sticker60: 'animada'
  }
  if (aliases[invoked]) return { mode: aliases[invoked], consumed: 0 }
  return { mode: normalize(args[0]), consumed: 1 }
}

export default defineCommand({
  name: 'figvip',
  aliases: ['figqualidade', 'figultra', 'figsemcorte', 'fignocrop', 'figquadrada', 'figredonda', 'figborda', 'figtexto', 'figanim', 'fig60', 'sticker60'],
  category: 'VIP',
  usage: '.figvip semcorte|quadrada|redonda|borda|texto|animada',
  description: 'Ferramentas avançadas de figurinha para usuários VIP.',
  vipOnly: true,
  priority: 'vip',
  slash: { model: '.figvip semcorte', categories: ['vip', 'mídia'], copyable: true },

  async execute({ sock, msg, args, rawArgs, invokedAs, logger, settings, senderNumber, chatNumber, metadata }) {
    const vipState = await getVipBenefits(senderNumber)
    if (!vipState.active) return reply(sock, msg, '🌸 este conjunto de figurinhas é exclusivo para usuários VIP.')
    const resolved = resolveMode(invokedAs, args)
    const mode = resolved.mode
    if (!['qualidade', 'semcorte', 'quadrada', 'redonda', 'borda', 'texto', 'animada'].includes(mode)) {
      return reply(sock, msg, [
        '🌸 *FIGURINHAS VIP*',
        '`.figqualidade` — qualidade reforçada',
        '`.figsemcorte` — preserva a imagem inteira',
        '`.figquadrada` — preenche o quadro sem distorcer',
        '`.figredonda` — máscara circular',
        '`.figborda` — adiciona borda branca',
        '`.figtexto seu texto` — legenda na figurinha',
        '`.fig60` — animação experimental de até 5 segundos, com fallback automático'
      ].join('\n'))
    }
    const source = await downloadStickerSource(msg, logger)
    if (!source) return reply(sock, msg, '💮 responda uma foto, vídeo, GIF ou figurinha.')
    const maxBytes = vipState.mediaLimitMb * 1024 * 1024
    if (source.fileLength > maxBytes || source.buffer.length > maxBytes) return reply(sock, msg, `💮 a mídia ultrapassa o limite de ${vipState.mediaLimitMb} MB do plano ${vipState.planName}.`)
    if (mode === 'animada' && (source.kind === 'image' || (source.kind === 'sticker' && !source.animated))) return reply(sock, msg, '💮 o modo experimental precisa de vídeo, GIF ou figurinha realmente animada.')
    if (mode === 'animada' && source.seconds > 5.5) return reply(sock, msg, '💮 o modo experimental aceita no máximo 5 segundos. Recorte o vídeo antes de enviar.')

    const textValue = resolved.consumed ? args.slice(resolved.consumed).join(' ') : rawArgs
    if (mode === 'texto' && !String(textValue || '').trim()) return reply(sock, msg, '💮 informe um texto curto depois do comando.')

    const result = await enqueueMediaTask(async () => {
      if (mode === 'animada') return convertVipAnimatedSticker(source.buffer, source.kind, logger)
      const options = {
        qualidade: { quality: source.kind === 'image' ? 92 : 76, fit: 'cover', fps: 30, durationSec: 5 },
        semcorte: { quality: 84, fit: 'contain', fps: 30, durationSec: 5 },
        quadrada: { quality: 84, fit: 'cover', fps: 30, durationSec: 5 },
        redonda: { quality: 82, fit: 'contain', round: true, fps: 24, durationSec: 5 },
        borda: { quality: 84, fit: 'contain', border: true, fps: 24, durationSec: 5 },
        texto: { quality: 82, fit: 'cover', text: String(textValue).trim().slice(0, 120), fps: 24, durationSec: 5 }
      }[mode]
      return { buffer: await convertToSticker(source.buffer, source.kind, logger, { ...options, timeoutMs: 120_000 }), fps: options.fps || 0, reduced: false }
    }, { vip: true })

    const stickerGroupName = await groupDisplayName(sock, msg.key.remoteJid, metadata)
    const sticker = addSakuraStickerMetadata(result.buffer, {
      botName: settings.botName,
      botNumber: settings.botNumber,
      userName: msg.pushName || 'VIP',
      userNumber: senderNumber,
      description: buildSakuraStickerDescription({ userName: msg.pushName || 'VIP', groupName: stickerGroupName }),
      emojis: ['🌸', '💮']
    })
    await sendStickerMedia(sock, msg, sticker, { priority: 'vip' })
    await saveStickerToLibrary(sticker, {
      source: `vip-${mode}`, creator: senderNumber, chat: chatNumber,
      animated: source.kind !== 'image'
    })
    if (mode === 'animada' && result.reduced) await reply(sock, msg, '💮 a qualidade foi ajustada para caber no WhatsApp, mantendo a animação codificada em 60 FPS.', { quoted: false })
  }
})
