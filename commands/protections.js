import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'
import { sendQuickButtons } from '../data/interactive.js'
import { getProtectionConfig, updateProtectionConfig } from '../data/protection-store.js'
import { writeAudit } from '../data/core-store.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])

function boolArg(value) {
  const word = normalize(value)
  if (onWords.has(word)) return true
  if (offWords.has(word)) return false
  return null
}

async function openPanel({ sock, msg, settings, logger, config }) {
  return sendQuickButtons({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'antilink-toggle',
    body: formatMessage([`Estado atual: *${config.antilinkEnabled ? 'ATIVADO' : 'DESATIVADO'}*`, '', 'Quando ativado, links enviados por membros comuns são apagados.', 'Dono, subdonos, administradores e usuários VIP continuam imunes.'].join('\n'), { title: 'PROTEÇÃO ANTILINK', icon: '🌸' }),
    includeUpdateCta: false,
    buttons: [
      { id: `${settings.prefix}antilink on`, text: '🌸 Ativar' },
      { id: `${settings.prefix}antilink off`, text: '💮 Desativar' },
      { id: `${settings.prefix}antilink status`, text: '🪷 Ver estado' }
    ]
  })
}

export default defineCommand({
  name: 'antilink',
  aliases: ['anti-link', 'antiurl', 'antilinks'],
  menuEntries: [
    { name: 'antilink', usage: '.antilink', description: 'Abre botões para ativar ou desativar links.', menuGroup: 'Administração' }
  ],
  category: 'Administração',
  usage: '.antilink [on|off|status]',
  description: 'Proteção de links com painel interativo.',
  groupOnly: true,
  adminOnly: true,
  needsMetadata: true,

  async execute({ sock, msg, args, settings, logger, senderNumber }) {
    const config = getProtectionConfig(msg.key.remoteJid)
    const action = normalize(args[0])
    if (!action) return openPanel({ sock, msg, settings, logger, config })
    if (action === 'status') {
      return reply(sock, msg, `AntiLink: *${config.antilinkEnabled ? 'ativado' : 'desativado'}*.\nImunes: dono, subdonos, administradores e VIPs.`, { title: 'ANTILINK' })
    }
    const enabled = boolArg(action)
    if (enabled == null) return openPanel({ sock, msg, settings, logger, config })
    const next = updateProtectionConfig(msg.key.remoteJid, { antilinkEnabled: enabled })
    writeAudit({ actor: senderNumber, action: 'protection.antilink', chat: msg.key.remoteJid, details: { enabled } })
    return reply(sock, msg, `AntiLink *${next.antilinkEnabled ? 'ativado' : 'desativado'}*.`, { title: 'ANTILINK' })
  }
})
