import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendQuickButtons } from '../data/interactive.js'
import { roleLevel } from '../data/permissions.js'
import { writeAudit } from '../data/core-store.js'
import { getAiGlobalConfig, getAiGroupConfig, updateAiGlobalConfig, updateAiGroupConfig } from '../data/ai-store.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])

export default defineCommand({
  name: 'autoia',
  aliases: ['iasakura', 'sakuraauto'],
  category: 'Inteligência artificial',
  menuEntries: [
    { name: 'autoia', usage: '.autoia on', description: 'Responde quando alguém disser Sakura em uma frase.', menuGroup: 'Inteligência artificial' }
  ],
  usage: '.autoia on|off',
  groupOnly: true,
  adminOnly: true,
  needsMetadata: true,
  async execute({ sock, msg, args, settings, role, senderNumber, logger }) {
    const noAction = !String(args[0] || '').trim()
    const action = normalize(args[0] || 'status')
    const global = getAiGlobalConfig()
    const group = getAiGroupConfig(msg.key.remoteJid)

    if (noAction) {
      return sendQuickButtons({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'autoia-toggle', includeUpdateCta: false,
        body: 'Escolha como a IA automática deve funcionar neste grupo.', buttons: [
          { id: `${settings.prefix}autoia on`, text: '🌸 Ativar' },
          { id: `${settings.prefix}autoia off`, text: '💮 Desativar' },
          { id: `${settings.prefix}autoia status`, text: '🪷 Ver estado' }
        ] })
    }

    if (action === 'status') {
      return reply(sock, msg, [
        `Auto IA neste grupo: ${group.enabled ? 'ligada' : 'desligada'}`,
        `Ativação: ${group.mode === 'all' ? 'todas as mensagens' : 'nome Sakura, menção ou resposta'}`,
        `Cooldown: ${Math.round(group.cooldownMs / 1000)}s`,
        `IA global: ${global.globalEnabled ? 'ligada' : 'desligada'}`
      ].join('\n'), { title: 'AUTO IA' })
    }

    if (onWords.has(action)) {
      if (!global.globalEnabled && roleLevel(role) < roleLevel('subowner')) {
        return reply(sock, msg, `A IA global está desligada. Peça ao dono para usar ${settings.prefix}ia global on.`)
      }
      if (!global.globalEnabled) updateAiGlobalConfig({ globalEnabled: true })
      const next = updateAiGroupConfig(msg.key.remoteJid, { enabled: true, mode: 'mention', cooldownMs: 8000 })
      writeAudit({ actor: senderNumber, action: 'ai.auto.enable', chat: msg.key.remoteJid, details: { cooldownMs: next.cooldownMs } })
      return reply(sock, msg, 'Auto IA ligada. A Sakura responderá quando o nome “Sakura” aparecer em qualquer parte da frase, além de menções e respostas.', { title: 'AUTO IA' })
    }

    if (offWords.has(action)) {
      updateAiGroupConfig(msg.key.remoteJid, { enabled: false })
      writeAudit({ actor: senderNumber, action: 'ai.auto.disable', chat: msg.key.remoteJid })
      return reply(sock, msg, 'Auto IA desligada neste grupo.', { title: 'AUTO IA' })
    }

    if (['sempre', 'all', 'tudo'].includes(action)) {
      updateAiGroupConfig(msg.key.remoteJid, { enabled: true, mode: 'all' })
      writeAudit({ actor: senderNumber, action: 'ai.auto.mode', chat: msg.key.remoteJid, details: { mode: 'all' } })
      return reply(sock, msg, 'Modo sempre ligado. A Sakura poderá responder mensagens comuns, respeitando cooldown e limite diário.', { title: 'AUTO IA' })
    }

    if (['mencao', 'menção', 'nome', 'sakura'].includes(action)) {
      updateAiGroupConfig(msg.key.remoteJid, { enabled: true, mode: 'mention' })
      writeAudit({ actor: senderNumber, action: 'ai.auto.mode', chat: msg.key.remoteJid, details: { mode: 'mention' } })
      return reply(sock, msg, 'Modo por nome ativado. Basta escrever “Sakura” naturalmente em uma frase.', { title: 'AUTO IA' })
    }

    return reply(sock, msg, [
      `${settings.prefix}autoia on`,
      `${settings.prefix}autoia off`,
      `${settings.prefix}autoia status`,
      `${settings.prefix}autoia mencao`,
      `${settings.prefix}autoia sempre`
    ].join('\n'), { title: 'AUTO IA' })
  }
})
