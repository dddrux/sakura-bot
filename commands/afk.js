import { defineCommand } from '../data/workstation.js'
import { getContextInfo } from '../data/messages.js'
import {
  buildAfkEnabledText,
  buildAfkReturnedText,
  getAfk,
  removeAfk,
  setAfk
} from '../data/afk.js'
import { reply } from '../data/reply.js'

function senderJid(msg, senderNumber) {
  return msg.key.participantAlt || msg.key.participant || `${senderNumber}@s.whatsapp.net`
}

function containsMention(msg, rawArgs = '') {
  const context = getContextInfo(msg.message)
  const mentions = [
    ...(context?.mentionedJid || []),
    ...(context?.mentionedJids || [])
  ].filter(Boolean)
  return mentions.length > 0 || /@\d{5,}/.test(String(rawArgs || ''))
}

export default defineCommand({
  name: 'afk',
  aliases: ['ausente'],
  category: 'Grupo',
  usage: '.afk [motivo|off]',
  description: 'Marca você como AFK e avisa quem mencionar ou responder você.',
  groupOnly: true,
  async execute({ sock, msg, args, rawArgs, senderNumber, chatNumber, logger }) {
    const action = String(args?.[0] || '').toLocaleLowerCase('pt-BR')
    const disable = ['off', 'sair', 'voltei', 'desativar', 'desligar'].includes(action)
    const jid = senderJid(msg, senderNumber)

    if (disable) {
      const removed = await removeAfk(chatNumber, senderNumber)
      if (!removed) {
        logger.debug({ sender: senderNumber, chat: chatNumber, action: 'afk-off', state: 'not-active' }, 'AFK já estava desativado')
        return reply(sock, msg, 'Você não está marcado como AFK.', { title: 'MODO AFK' })
      }
      logger.success({ sender: senderNumber, chat: chatNumber, action: 'afk-disabled', durationMs: Date.now() - removed.since }, 'AFK desativado manualmente')
      return reply(sock, msg, buildAfkReturnedText(senderNumber, removed), { mentions: [jid], title: 'MODO AFK' })
    }

    if (containsMention(msg, rawArgs)) {
      logger.warn({ sender: senderNumber, chat: chatNumber, action: 'afk-rejected-mention', textPreview: String(rawArgs).slice(0, 100) }, 'tentativa de ativar AFK para outra pessoa')
      return reply(sock, msg, 'O AFK é individual.\nA própria pessoa deve usar *.afk [motivo]*.', { title: 'MODO AFK' })
    }

    const previous = await getAfk(chatNumber, senderNumber)
    const reason = String(rawArgs || '').replace(/\s+/g, ' ').trim() || 'Sem motivo informado.'
    const record = await setAfk(chatNumber, senderNumber, {
      jid,
      name: msg.pushName || `@${senderNumber}`,
      reason,
      since: Date.now()
    })
    logger.success({
      sender: senderNumber,
      chat: chatNumber,
      action: previous ? 'afk-updated' : 'afk-enabled',
      reasonLength: record.reason.length,
      reasonPreview: record.reason.slice(0, 100)
    }, previous ? 'AFK atualizado' : 'AFK ativado')

    return reply(sock, msg, buildAfkEnabledText(senderNumber, record), { mentions: [jid], title: 'MODO AFK' })
  }
})
