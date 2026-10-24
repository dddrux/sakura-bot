import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { roleLevel } from '../data/permissions.js'
import { writeAudit } from '../data/core-store.js'
import { clearAiContext, maybeHandleAi } from '../data/ai-engine.js'
import {
  getAiGlobalConfig,
  getAiGroupConfig,
  updateAiGlobalConfig,
  updateAiGroupConfig
} from '../data/ai-store.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])
const state = value => value ? 'ligada' : 'desligada'
const duration = ms => `${Math.round(Number(ms || 0) / 1000)}s`

function boolArg(value) {
  const word = normalize(value)
  if (onWords.has(word)) return true
  if (offWords.has(word)) return false
  return null
}

function canManageGlobal(role) {
  return roleLevel(role) >= roleLevel('subowner')
}

function statusText({ global, group, tokenCount, isGroup }) {
  return [
    `global: ${state(global.globalEnabled)}`,
    `conversas privadas: ${state(global.privateEnabled)}`,
    isGroup ? `neste grupo: ${state(group.enabled)}` : '',
    isGroup ? `modo: ${group.mode === 'all' ? 'todas as mensagens' : 'menção/resposta'}` : '',
    isGroup ? `limite diário: ${group.dailyUsed}/${group.dailyLimit}` : '',
    isGroup ? `intervalo: ${duration(group.cooldownMs)}` : '',
    `modelo: ${global.model}`,
    `tokens rotativos: ${tokenCount}`,
    'tokens ficam em config/sakura.config.json, sem criptografia',
    'a IA não chama a API quando estiver desativada ou sem token válido'
  ].filter(Boolean).join('\n')
}

export default defineCommand({
  name: 'ia',
  aliases: ['sakuraia', 'iastatus', 'iagrupo', 'aistatus'],
  menuEntries: [
    { name: 'ia', usage: '.ia', description: 'Mostra e configura a IA da Sakura.', menuGroup: 'Inteligência artificial' },
    { name: 'iagrupo', usage: '.ia grupo on', description: 'Ativa a IA no grupo atual.', menuGroup: 'Configuração' }
  ],
  category: 'Inteligência artificial',
  usage: '.ia status',
  needsMetadata: true,
  sensitiveArgs: true,
  async execute({ sock, msg, args, rawArgs, settings, isGroup, isAdmin, isOwner, role, senderNumber, logger, commands, chatNumber }) {
    const action = normalize(args[0] || 'status')
    const global = getAiGlobalConfig()
    const group = isGroup ? getAiGroupConfig(msg.key.remoteJid) : null
    const controls = new Set(['status','painel','global','privado','pv','grupo','modo','limite','cooldown','intervalo','modelo','personalidade','limparcontexto','esquecer'])
    const askPrefix = new Set(['perguntar','pergunta','ask','chat'])
    if (rawArgs?.trim() && (!controls.has(action) || askPrefix.has(action))) {
      const prompt = askPrefix.has(action) ? String(rawArgs).trim().replace(/^\S+\s*/u, '') : String(rawArgs).trim()
      if (!prompt) return reply(sock, msg, `Use ${settings.prefix}ia sua pergunta.`, { title: 'SAKURA IA' })
      return maybeHandleAi({
        sock, msg, text: prompt, logger, isGroup, mentionedBot: true, commands,
        force: true, notifyFailure: true,
        numbers: { sender: senderNumber, chat: chatNumber || msg.key.remoteJid }
      })
    }

    if (['status', 'painel', ''].includes(action)) {
      return reply(sock, msg, statusText({ global, group, tokenCount: (settings.aiTokens || []).length, isGroup }), { title: 'OPÇÕES DA IA' })
    }

    if (action === 'global') {
      if (!canManageGlobal(role)) return reply(sock, msg, 'Apenas o dono ou um subdono pode alterar a IA global.')
      const enabled = boolArg(args[1])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}ia global on ou off.`)
      const next = updateAiGlobalConfig({ globalEnabled: enabled })
      writeAudit({ actor: senderNumber, action: 'ai.global', details: { enabled } })
      return reply(sock, msg, `IA global ${state(next.globalEnabled)}.`)
    }

    if (action === 'privado' || action === 'pv') {
      if (!canManageGlobal(role)) return reply(sock, msg, 'Apenas o dono ou um subdono pode alterar a IA no privado.')
      const enabled = boolArg(args[1])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}ia privado on ou off.`)
      const next = updateAiGlobalConfig({ privateEnabled: enabled })
      writeAudit({ actor: senderNumber, action: 'ai.private', details: { enabled } })
      return reply(sock, msg, `IA em conversas privadas ${state(next.privateEnabled)}.`)
    }

    if (action === 'grupo') {
      if (!isGroup) return reply(sock, msg, 'Essa configuração só existe dentro de grupos.')
      if (!isAdmin) return reply(sock, msg, 'Apenas administradores podem configurar a IA deste grupo.')
      const enabled = boolArg(args[1])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}ia grupo on ou off.`)
      const next = updateAiGroupConfig(msg.key.remoteJid, { enabled })
      writeAudit({ actor: senderNumber, action: 'ai.group', chat: msg.key.remoteJid, details: { enabled } })
      return reply(sock, msg, `IA deste grupo ${state(next.enabled)}.`)
    }

    if (action === 'modo') {
      if (!isGroup) return reply(sock, msg, 'Defina o modo dentro do grupo desejado.')
      if (!isAdmin) return reply(sock, msg, 'Apenas administradores podem alterar o modo da IA.')
      const mode = ['sempre', 'all', 'tudo'].includes(normalize(args[1])) ? 'all' : ['mencao', 'menção', 'mention'].includes(normalize(args[1])) ? 'mention' : ''
      if (!mode) return reply(sock, msg, `Use ${settings.prefix}ia modo mencao ou ${settings.prefix}ia modo sempre.`)
      updateAiGroupConfig(msg.key.remoteJid, { mode })
      writeAudit({ actor: senderNumber, action: 'ai.group.mode', chat: msg.key.remoteJid, details: { mode } })
      return reply(sock, msg, mode === 'all' ? 'A Sakura poderá responder mensagens comuns neste grupo, respeitando cooldown e limite.' : 'A Sakura responderá apenas quando for mencionada, chamada pelo nome ou respondida.')
    }

    if (action === 'limite') {
      if (!isGroup) return reply(sock, msg, 'Defina o limite dentro do grupo desejado.')
      if (!isAdmin) return reply(sock, msg, 'Apenas administradores podem alterar o limite deste grupo.')
      const dailyLimit = Number(args[1])
      if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500) return reply(sock, msg, 'Escolha um limite diário entre 1 e 500 respostas.')
      updateAiGroupConfig(msg.key.remoteJid, { dailyLimit })
      writeAudit({ actor: senderNumber, action: 'ai.group.limit', chat: msg.key.remoteJid, details: { dailyLimit } })
      return reply(sock, msg, `Limite diário ajustado para ${dailyLimit} respostas.`)
    }

    if (action === 'cooldown' || action === 'intervalo') {
      if (!isGroup) return reply(sock, msg, 'Defina o intervalo dentro do grupo desejado.')
      if (!isAdmin) return reply(sock, msg, 'Apenas administradores podem alterar o intervalo deste grupo.')
      const seconds = Number(args[1])
      if (!Number.isFinite(seconds) || seconds < 3 || seconds > 600) return reply(sock, msg, 'Escolha um intervalo entre 3 e 600 segundos.')
      updateAiGroupConfig(msg.key.remoteJid, { cooldownMs: Math.round(seconds * 1000) })
      writeAudit({ actor: senderNumber, action: 'ai.group.cooldown', chat: msg.key.remoteJid, details: { seconds } })
      return reply(sock, msg, `Intervalo ajustado para ${Math.round(seconds)} segundos.`)
    }

    if (action === 'modelo') {
      if (!canManageGlobal(role)) return reply(sock, msg, 'Apenas dono e subdonos podem alterar o modelo.')
      const model = String(args[1] || '').trim()
      if (!/^[a-z0-9._/-]{3,120}$/i.test(model)) return reply(sock, msg, `Use ${settings.prefix}ia modelo nome/do-modelo.`)
      updateAiGlobalConfig({ model })
      writeAudit({ actor: senderNumber, action: 'ai.model', details: { model } })
      return reply(sock, msg, `Modelo definido como ${model}.`)
    }

    if (action === 'personalidade') {
      if (!isOwner) return reply(sock, msg, 'Somente o dono principal pode alterar a personalidade da Sakura.')
      const sub = normalize(args[1] || 'ver')
      if (sub === 'ver') return reply(sock, msg, global.systemPrompt || 'A personalidade está sendo lida de config/ai-personality.txt.', { title: 'PERSONALIDADE DA IA' })
      if (sub === 'restaurar' || sub === 'reset') {
        updateAiGlobalConfig({ systemPrompt: '' })
        writeAudit({ actor: senderNumber, action: 'ai.personality.reset' })
        return reply(sock, msg, 'A personalidade voltou a usar config/ai-personality.txt.')
      }
      const marker = rawArgs.match(/^\S+\s+\S+\s+([\s\S]+)$/)?.[1] || ''
      if (marker.trim().length < 40) return reply(sock, msg, `Use ${settings.prefix}ia personalidade definir <texto com pelo menos 40 caracteres>.`)
      updateAiGlobalConfig({ systemPrompt: marker })
      writeAudit({ actor: senderNumber, action: 'ai.personality.update', details: { length: marker.length } })
      return reply(sock, msg, 'Personalidade personalizada atualizada sem exibir o texto nos logs.')
    }

    if (action === 'limparcontexto' || action === 'esquecer') {
      clearAiContext(msg.key.remoteJid)
      return reply(sock, msg, 'Contexto recente desta conversa removido.')
    }

    return reply(sock, msg, [
      `${settings.prefix}ia status`,
      `${settings.prefix}ia grupo on|off`,
      `${settings.prefix}autoia on|off`,
      `${settings.prefix}ia modo mencao|sempre`,
      `${settings.prefix}ia limite 50`,
      `${settings.prefix}ia cooldown 15`,
      `${settings.prefix}ia global on|off`,
      `${settings.prefix}ia privado on|off`,
      `${settings.prefix}ia modelo nome/do-modelo`,
      `${settings.prefix}ia limparcontexto`,
      `${settings.prefix}iatoken status`,
      `${settings.prefix}iaconfig`
    ].join('\n'), { title: 'OPÇÕES DA IA' })
  }
})
