import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { sendSocialAction, normalizeSocialAction } from '../data/social-actions.js'
import { recordSocialAction, SOCIAL_ACTIONS } from '../data/social-store.js'
import { displayUser, formatMentionName, groupNameMap, resolveTarget } from '../data/user-display.js'
import { sendCommandResult } from '../data/fun-media-store.js'

const cooldowns = new Map()
const ACTION_COOLDOWN_MS = 5_000

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const TEXTS = Object.freeze({
  beijar: ({ from, to }) => `🌸 ${from} deu um beijo em ${to}.`,
  abracar: ({ from, to }) => `🌸 ${from} abraçou ${to} bem forte.`,
  cafune: ({ from, to }) => `🌸 ${from} fez um cafuné carinhoso em ${to}.`,
  acariciar: ({ from, to }) => `💮 ${from} acariciou ${to} com carinho.`,
  cumprimentar: ({ from, to }) => `💮 ${from} cumprimentou ${to}.`,
  darmao: ({ from, to }) => `🌸 ${from} deu a mão para ${to}.`,
  presentear: ({ from, to }) => `🌸 ${from} deu um presente especial para ${to}.`
})

function actionFor(invokedAs, text, prefix) {
  return normalizeSocialAction(invokedAs || String(text || '').slice(String(prefix || '.').length).trim().split(/\s+/, 1)[0])
}

function cooldownKey(chat, sender, action) {
  return `${chat}:${sender}:${action}`
}

function remainingCooldown(key) {
  const until = Number(cooldowns.get(key) || 0)
  if (until <= Date.now()) {
    cooldowns.delete(key)
    return 0
  }
  return until - Date.now()
}

async function sendPanel({ sock, msg, settings, logger }) {
  const rows = Object.entries(SOCIAL_ACTIONS).map(([action, info]) => ({
    id: `${settings.prefix}${action}`,
    title: `${info.emoji} ${info.label}`,
    description: 'Use marcando ou respondendo a uma pessoa'
  }))
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'social-actions',
    body: formatMessage('Escolha uma ação e marque a pessoa no comando.\nTodas as ações registram autor e alvo corretamente.', { title: 'AÇÕES SOCIAIS', icon: '🌸' }),
    buttonText: '🌸 Escolher ação',
    sections: [{ title: 'Ações disponíveis', rows }]
  })
}

export default defineCommand({
  name: 'acoes',
  aliases: ['acao', 'beijar', 'beijo', 'abracar', 'abraco', 'cafune', 'acariciar', 'carinho', 'cumprimentar', 'darmao', 'maos', 'presentear', 'presente', 'darpresente'],
  menuEntries: [
    { name: 'acoes', usage: '.acoes', description: 'Lista ações sociais com mídia configurável.', menuGroup: 'Social' },
    { name: 'beijar', usage: '.beijar @pessoa', description: 'Envia uma ação de beijo.', menuGroup: 'Ações' },
    { name: 'abracar', usage: '.abracar @pessoa', description: 'Envia uma ação de abraço.', menuGroup: 'Ações' },
    { name: 'cafune', usage: '.cafune @pessoa', description: 'Faz cafuné na pessoa marcada.', menuGroup: 'Ações' },
    { name: 'presentear', usage: '.presentear @pessoa', description: 'Dá um presente simbólico.', menuGroup: 'Ações' }
  ],
  category: 'Grupo',
  usage: '.acoes | .beijar @pessoa',
  groupOnly: true,
  async execute({ sock, msg, args, text, invokedAs, settings, senderNumber, metadata, logger }) {
    const used = normalize(invokedAs || String(text || '').slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const action = actionFor(invokedAs, text, settings.prefix)
    if (used === 'acoes' || used === 'acao' || !action) return sendPanel({ sock, msg, settings, logger })

    const names = await groupNameMap(sock, msg.key.remoteJid, metadata)
    const target = await resolveTarget({ sock, msg, args })
    if (used === 'beijo' && !target.number) {
      const self = displayUser(senderNumber, names)
      const value = Math.floor(Math.random() * 101)
      return sendCommandResult({
        sock,
        msg,
        command: 'beijo',
        percent: value,
        caption: `🌸 ${formatMentionName(self)} é:
*${value}% Beijável*`,
        mentions: [self.mentionJid || self.phoneJid || self.jid].filter(Boolean)
      })
    }
    if (!target.number) return reply(sock, msg, `Marque ou responda a uma pessoa. Exemplo: *${settings.prefix}${used} @pessoa*.`)
    if (!names.has(target.number)) return reply(sock, msg, 'A pessoa precisa estar neste grupo.')
    if (target.number === String(senderNumber)) return reply(sock, msg, 'Escolha outra pessoa para essa ação.')
    if (target.number === String(settings.botNumber || '').replace(/\D/g, '')) return reply(sock, msg, 'Escolha um membro do grupo; a Sakura apenas organiza a brincadeira.')

    const key = cooldownKey(msg.key.remoteJid, senderNumber, action)
    const remaining = remainingCooldown(key)
    if (remaining) return reply(sock, msg, `Aguarde ${Math.ceil(remaining / 1000)} segundo(s) antes de repetir essa ação.`)
    cooldowns.set(key, Date.now() + ACTION_COOLDOWN_MS)

    const from = displayUser(senderNumber, names)
    const to = displayUser(target.number, names)
    const caption = TEXTS[action]({ from: formatMentionName(from), to: formatMentionName(to) })
    recordSocialAction({ chat: msg.key.remoteJid, action, actor: senderNumber, target: target.number })
    return sendSocialAction({ sock, msg, action, caption, mentions: [from.jid, to.jid].filter(Boolean) })
  }
})
