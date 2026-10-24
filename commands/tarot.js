import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { maybeHandleAi } from '../data/ai-engine.js'
import { sendNativeList, sendQuickButtons } from '../data/interactive.js'
import {
  TAROT_MODES,
  buildTarotAiPrompt,
  buildTarotBaseText,
  consumeTarotQuota,
  createPendingTarotReading,
  drawTarotCards,
  getPendingTarotReading,
  hasConfiguredTarotAiToken,
  parseTarotRequest,
  renderTarotImage
} from '../data/tarot.js'

const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)

async function sendTarotCatalog({ sock, msg, settings, logger }) {
  const p = settings.prefix
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'Tarô da Sakura',
    menuMedia: false,
    body: 'Escolha uma tiragem:',
    buttonText: '⭐ Tiragens',
    sections: [{
      title: '⭐ Tiragens',
      rows: [
        { id: `${p}tarot SUA PERGUNTA`, title: '⭐ Leitura geral', description: 'Passado • Presente • Caminho' },
        { id: `${p}tarot simnao SUA PERGUNTA`, title: '💮 Sim ou não', description: 'Tendência em 3 cartas' },
        { id: `${p}tarot amor SUA PERGUNTA`, title: '🌸 Amor', description: 'Você • Vínculo • Caminho' },
        { id: `${p}tarot trabalho SUA PERGUNTA`, title: '💎 Trabalho', description: 'Situação • Desafio • Caminho' },
        { id: `${p}tarot conselho SUA PERGUNTA`, title: '💮 Conselho', description: 'Agora • Atenção • Conselho' }
      ]
    }]
  })
}

async function sendInterpretation({ sock, msg, reading, logger, isGroup, senderNumber, chatNumber, commands }) {
  if (!hasConfiguredTarotAiToken()) {
    return reply(sock, msg, 'IA indisponível no momento.', { title: 'TARÔ' })
  }

  const result = await maybeHandleAi({
    sock,
    msg,
    text: buildTarotAiPrompt(reading.question, reading.cards, { mode: reading.mode }),
    logger,
    isGroup,
    mentionedBot: true,
    commands,
    force: true,
    notifyFailure: true,
    numbers: { sender: senderNumber, chat: chatNumber || msg.key.remoteJid }
  })

  if (!result?.handled && !['key-unavailable', 'cooldown', 'provider-error', 'global-off'].includes(result?.reason)) {
    await reply(sock, msg, 'Interpretação indisponível agora. A tiragem fica salva por alguns minutos.', { title: 'TARÔ' }).catch(() => {})
  }
  return result
}

export default defineCommand({
  name: 'tarot',
  aliases: ['tarô', 'taro'],
  category: 'Diversão',
  usage: '.tarot sua pergunta',
  description: 'Tira 3 cartas em uma imagem e libera a interpretação por botão.',
  menuEntries: [{ name: 'tarot', usage: '.tarot vou conseguir melhorar?', description: 'Tarô visual com modos e interpretação opcional', menuGroup: 'Tarô' }],
  async execute({ sock, msg, rawArgs, args, logger, settings, isGroup, senderNumber, chatNumber, commands, isVip: vipAccess }) {
    const raw = clean(rawArgs)
    const action = String(args?.[0] || '').toLowerCase()

    if (action === 'interpretar') {
      const readingId = String(args?.[1] || '').trim()
      const reading = await getPendingTarotReading(readingId, {
        senderNumber,
        chatJid: msg.key.remoteJid
      })
      if (!reading) return reply(sock, msg, 'Leitura expirada ou de outra pessoa. Faça uma nova tiragem.', { title: 'TARÔ' })
      return sendInterpretation({ sock, msg, reading, logger, isGroup, senderNumber, chatNumber, commands })
    }

    if (!raw) return sendTarotCatalog({ sock, msg, settings, logger })

    const parsed = parseTarotRequest(raw)
    if (!parsed.question || /^sua pergunta$/i.test(parsed.question)) {
      return reply(sock, msg, `Escreva sua pergunta. Ex: ${settings.prefix}tarot simnao vou conseguir?`, { title: 'TARÔ' })
    }

    const quota = await consumeTarotQuota(senderNumber, { vip: Boolean(vipAccess), limit: 10 })
    if (!quota.allowed) {
      return reply(sock, msg, 'Limite de 10 tiragens por dia. VIP não tem limite.', { title: 'TARÔ' })
    }

    const cards = drawTarotCards()
    let image
    try {
      image = await renderTarotImage(cards, { logger })
    } catch (error) {
      logger?.warn?.({ error, stage: 'tarot-render' }, 'falha ao renderizar tarô visual')
      return reply(sock, msg, 'Não consegui montar a imagem agora. Tente de novo.', { title: 'TARÔ' })
    }

    const reading = await createPendingTarotReading({
      chatJid: msg.key.remoteJid,
      senderNumber,
      question: parsed.question,
      mode: parsed.mode,
      cards
    })

    const body = buildTarotBaseText(parsed.question, cards, { mode: parsed.mode })
    logger?.info?.({ action: 'tarot', mode: parsed.mode, vip: Boolean(vipAccess), remaining: quota.unlimited ? 'vip' : quota.remaining }, 'tiragem de tarô criada')

    return sendQuickButtons({
      sock,
      jid: msg.key.remoteJid,
      quoted: msg,
      logger,
      kind: 'Tarô da Sakura',
      body: `${body}\n\nToque abaixo para ver a interpretação.`,
      media: { kind: 'image', buffer: image },
      buttons: [{ text: '⭐ Ver interpretação', id: `${settings.prefix}tarot interpretar ${reading.id}` }]
    })
  }
})
