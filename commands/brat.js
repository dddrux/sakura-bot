import { defineCommand } from '../data/workstation.js'
import { createAnimatedBratSticker, createStaticBratSticker, resolveBratAlignment, resolveBratTheme } from '../data/media.js'
import { getQuotedMessage, getMessageText } from '../data/messages.js'
import { reply } from '../data/reply.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription } from '../data/sticker-metadata.js'
import { saveStickerToLibrary } from '../data/sticker-library.js'
import { groupDisplayName } from '../data/user-display.js'
import { consumeBratQuota } from '../data/brat-quota.js'

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function isKnownTheme(value = '') {
  const raw = normalize(value)
  const resolved = resolveBratTheme(raw)
  return resolved.key === raw || [
    'green', 'lime', 'brat', 'pink', 'blue', 'purple', 'lilas', 'red', 'white', 'black',
    'verde', 'rosa', 'azul', 'roxo', 'vermelho', 'branco', 'preto', 'rainbow', 'arcoiris', 'arco-iris'
  ].includes(raw)
}

function isKnownAlignment(value = '') {
  const raw = normalize(value)
  return ['esquerda', 'left', 'inicio', 'start', 'centro', 'center', 'central', 'meio', 'direita', 'right', 'fim', 'end'].includes(raw)
}

function parseLegacyFlags(source = '') {
  const chunks = String(source || '').trim().split(/\s+/).filter(Boolean)
  let animated = false
  let theme = 'branco'
  let alignment = 'esquerda'
  const textParts = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const key = normalize(chunk)

    if (['--anim', '-a', 'anim', 'animado', '--animado'].includes(key)) {
      animated = true
      continue
    }
    if (['--cor', '--color', '-c'].includes(key)) {
      theme = chunks[index + 1] || theme
      index += 1
      continue
    }
    if (['--alinhar', '--alinhamento', '--align'].includes(key)) {
      alignment = chunks[index + 1] || alignment
      index += 1
      continue
    }

    const colorMatch = chunk.match(/^--(?:cor|color)=(.+)$/i) || chunk.match(/^-c=(.+)$/i)
    if (colorMatch) {
      theme = colorMatch[1]
      continue
    }
    const alignMatch = chunk.match(/^--(?:alinhar|alinhamento|align)=(.+)$/i)
    if (alignMatch) {
      alignment = alignMatch[1]
      continue
    }
    textParts.push(chunk)
  }

  return { animated, theme, alignment: resolveBratAlignment(alignment), text: textParts.join(' ').trim() }
}

function parseBratInput(source = '') {
  const raw = String(source || '').trim()
  if (!raw.includes('|')) return parseLegacyFlags(raw)

  const parts = raw.split('|').map(part => part.trim()).filter(Boolean)
  let animated = false
  let theme = 'branco'
  let alignment = 'esquerda'
  const textParts = []

  for (const part of parts) {
    const key = normalize(part)
    if (['anim', 'animado', 'animação', 'animacao'].includes(key)) {
      animated = true
      continue
    }
    if (isKnownTheme(key)) {
      theme = key
      continue
    }
    if (isKnownAlignment(key)) {
      alignment = key
      continue
    }
    textParts.push(part)
  }

  return { animated, theme, alignment: resolveBratAlignment(alignment), text: textParts.join(' ').trim() }
}

async function sendBratBuilder(sock, msg, settings) {
  const model = `${settings.prefix}brat SEU TEXTO | rosa | esquerda`
  return reply(sock, msg, [
    'Monte a figurinha pelo seletor ou copie o modelo.',
    'O padrão usa alinhamento à esquerda para não deixar o texto excessivamente centralizado.',
    'A arte sempre permanece dentro do quadro 1:1.'
  ].join('\n'), {
    title: 'BRAT STUDIO',
    nativeFlow: [
      {
        text: '🌸 personalizar Brat',
        sections: [
          {
            title: '🌸 Cores',
            rows: [
              { id: `${settings.prefix}brat SEU TEXTO | rosa | esquerda`, title: '🌸 Rosa', description: 'Rosa + esquerda' },
              { id: `${settings.prefix}brat SEU TEXTO | branco | esquerda`, title: '🌸 Branco', description: 'Branco + esquerda' },
              { id: `${settings.prefix}brat SEU TEXTO | preto | esquerda`, title: '💮 Preto', description: 'Preto + esquerda' },
              { id: `${settings.prefix}brat SEU TEXTO | verde | esquerda`, title: '🌸 Verde Brat', description: 'Verde clássico + esquerda' },
              { id: `${settings.prefix}brat SEU TEXTO | azul | esquerda`, title: '🌸 Azul', description: 'Azul + esquerda' },
              { id: `${settings.prefix}brat SEU TEXTO | roxo | esquerda`, title: '💮 Roxo', description: 'Roxo + esquerda' },
              { id: `${settings.prefix}brat PALAVRA | rainbow | animado`, title: '💎 Rainbow animado', description: 'VIP • fundo rainbow animado' }
            ]
          },
          {
            title: '🌸 Alinhamento',
            rows: [
              { id: `${settings.prefix}brat SEU TEXTO | rosa | esquerda`, title: '🌸 Esquerda', description: 'Padrão recomendado' },
              { id: `${settings.prefix}brat SEU TEXTO | rosa | centro`, title: '🌸 Centro', description: 'Centralização opcional' },
              { id: `${settings.prefix}brat SEU TEXTO | rosa | direita`, title: '💮 Direita', description: 'Alinha ao lado direito' }
            ]
          }
        ]
      },
      { text: '🌸 copiar modelo', copy: model }
    ]
  })
}

export default defineCommand({
  name: 'brat',
  aliases: [],
  category: 'Mídia',
  usage: '.brat texto | rosa | esquerda',
  description: 'Cria Brat 1:1 com cor, texto e alinhamento configuráveis.',
  reaction: '🌸',
  slash: {
    model: '.brat SEU TEXTO | rosa | esquerda',
    categories: ['cor', 'alinhamento', 'animação'],
    copyable: true
  },

  async execute({ sock, msg, rawArgs, logger, settings, senderNumber, chatNumber, metadata, isVip: vipAccess }) {
    const quoted = getQuotedMessage(msg)
    const quotedText = quoted ? getMessageText(quoted.message) : ''
    const source = String(rawArgs || quotedText || '').trim()
    const parsed = parseBratInput(source)

    if (!parsed.text) return sendBratBuilder(sock, msg, settings)

    const vip = Boolean(vipAccess)
    if (parsed.theme === 'rainbow') parsed.animated = true
    if (parsed.theme === 'rainbow' && !vip) {
      return reply(sock, msg, '💎 O Brat rainbow animado é exclusivo para VIP.')
    }
    const quota = await consumeBratQuota(senderNumber, { vip, limit: 10 })
    if (!quota.allowed) {
      return reply(sock, msg, '🌸 Você atingiu o limite de 10 Brats de hoje. VIP não tem limite.')
    }

    const stickerGroupName = await groupDisplayName(sock, msg.key.remoteJid, metadata)
    const stickerDescription = buildSakuraStickerDescription({ userName: msg.pushName || 'Usuário', groupName: stickerGroupName })

    if (parsed.animated) {
      const wordCount = parsed.text.split(/\s+/).filter(Boolean).length
      if (wordCount !== 1) {
        await reply(sock, msg, 'Na animação use apenas uma palavra.', { title: 'BRAT' })
        return
      }
      const rawSticker = await createAnimatedBratSticker(parsed.text, { theme: parsed.theme, alignment: parsed.alignment }, logger)
      const sticker = addSakuraStickerMetadata(rawSticker, { botName: settings.botName, botNumber: settings.botNumber, userName: msg.pushName || 'Usuário', userNumber: senderNumber, description: stickerDescription })
      await sock.sendMessage(msg.key.remoteJid, { sticker }, { quoted: msg })
      await saveStickerToLibrary(sticker, { source: 'brat-animated', creator: senderNumber, chat: chatNumber, animated: true, theme: parsed.theme, alignment: parsed.alignment })
      return
    }

    const rawSticker = await createStaticBratSticker(parsed.text, { theme: parsed.theme, alignment: parsed.alignment }, logger)
    const sticker = addSakuraStickerMetadata(rawSticker, { botName: settings.botName, botNumber: settings.botNumber, userName: msg.pushName || 'Usuário', userNumber: senderNumber, description: stickerDescription })
    await sock.sendMessage(msg.key.remoteJid, { sticker }, { quoted: msg })
    await saveStickerToLibrary(sticker, { source: 'brat-static', creator: senderNumber, chat: chatNumber, animated: false, theme: parsed.theme, alignment: parsed.alignment })
  }
})
