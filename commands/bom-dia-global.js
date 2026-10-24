import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendQuickButtons } from '../data/interactive.js'
import { writeAudit } from '../data/core-store.js'
import { bulkSendQueueStatus } from '../data/bulk-send-queue.js'
import { removeCustomDailyAudio, saveDailyAudioFromMessage } from '../data/automation-media.js'
import {
  GLOBAL_MORNING_DEFAULT_MESSAGES,
  getGlobalMorningConfig,
  globalMorningStoreStatus,
  isGlobalMorningDisabledForGroup,
  setGlobalMorningGroupDisabled,
  updateGlobalMorningConfig
} from '../data/global-morning-store.js'
import { testGlobalMorningNow } from '../data/group-automations.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])

function statusText() {
  const status = globalMorningStoreStatus()
  const config = status.config
  const queue = bulkSendQueueStatus()
  return [
    `Estado: ${config.enabled ? 'ligado' : 'desligado'}`,
    `Horário: ${config.time} (${config.timezone})`,
    `Mensagens disponíveis: ${config.messages.length}`,
    `Áudio: ${config.audioPath === 'off' ? 'desligado' : config.audioPath.startsWith('custom/') ? 'personalizado' : 'padrão Sakura'}`,
    `Grupos ignorados: ${status.excludedGroups}`,
    `Fila segura: ${queue.pending} pendente(s) • limite ${queue.limitPerMinute}/min`,
    'Rotinas específicas de grupo têm prioridade para evitar mensagens duplicadas.'
  ].join('\n')
}

export default defineCommand({
  name: 'bomdiaglobal',
  aliases: ['bomdia9', 'bomdiatodos', 'morningglobal'],
  category: 'Dono',
  menuEntries: [
    { name: 'bomdiaglobal', usage: '.bomdiaglobal status', description: 'Bom dia seguro às 09:00 nos grupos autorizados.', menuGroup: 'Dono' }
  ],
  usage: '.bomdiaglobal status',
  ownerOnly: true,
  async execute({ sock, msg, args, rawArgs, settings, senderNumber, isGroup, logger }) {
    const noAction = !String(args[0] || '').trim()
    const action = normalize(args[0] || 'status')
    const config = getGlobalMorningConfig()

    if (noAction) return sendQuickButtons({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'bomdia-global-toggle', includeUpdateCta: false,
      body: statusText(), buttons: [
        { id: `${settings.prefix}bomdiaglobal on`, text: '🌸 Ativar' },
        { id: `${settings.prefix}bomdiaglobal off`, text: '💮 Desativar' },
        { id: `${settings.prefix}bomdiaglobal status`, text: '🪷 Ver estado' }
      ] })
    if (action === 'status') return reply(sock, msg, statusText(), { title: 'BOM DIA GLOBAL' })

    if (onWords.has(action) || offWords.has(action)) {
      const enabled = onWords.has(action)
      const next = updateGlobalMorningConfig({ enabled })
      writeAudit({ actor: senderNumber, action: 'automation.global-morning', details: { enabled } })
      return reply(sock, msg, `Bom dia global ${next.enabled ? 'ligado' : 'desligado'}. Horário: ${next.time} (${next.timezone}).`, { title: 'BOM DIA GLOBAL' })
    }

    if (['hora', 'horario', 'horário'].includes(action)) {
      try {
        const next = updateGlobalMorningConfig({ time: args[1] })
        writeAudit({ actor: senderNumber, action: 'automation.global-morning.time', details: { time: next.time } })
        return reply(sock, msg, `Horário global alterado para ${next.time}.`)
      } catch (error) { return reply(sock, msg, error.message) }
    }

    if (['fuso', 'timezone'].includes(action)) {
      try {
        const next = updateGlobalMorningConfig({ timezone: args[1] })
        writeAudit({ actor: senderNumber, action: 'automation.global-morning.timezone', details: { timezone: next.timezone } })
        return reply(sock, msg, `Fuso global alterado para ${next.timezone}.`)
      } catch (error) { return reply(sock, msg, error.message) }
    }

    if (action === 'audio') {
      const mode = normalize(args[1])
      if (['off', 'desligar', 'sem'].includes(mode)) {
        await removeCustomDailyAudio(config.audioPath)
        updateGlobalMorningConfig({ audioPath: 'off' })
        return reply(sock, msg, 'Áudio do bom dia global desligado.')
      }
      if (['padrao', 'padrão', 'restaurar', 'acorda'].includes(mode)) {
        await removeCustomDailyAudio(config.audioPath)
        updateGlobalMorningConfig({ audioPath: 'legacy/acorda.mp3' })
        return reply(sock, msg, 'Áudio padrão da Sakura restaurado.')
      }
      try {
        const saved = await saveDailyAudioFromMessage({ msg, logger })
        await removeCustomDailyAudio(config.audioPath)
        updateGlobalMorningConfig({ audioPath: saved.relative })
        writeAudit({ actor: senderNumber, action: 'automation.global-morning.audio', details: { sizeBytes: saved.sizeBytes } })
        return reply(sock, msg, `Áudio global salvo (${(saved.sizeBytes / 1024 / 1024).toFixed(2)} MB).`)
      } catch (error) { return reply(sock, msg, error.message) }
    }

    if (action === 'mensagens' || action === 'lista') {
      return reply(sock, msg, config.messages.map((text, index) => `${index + 1}. ${text}`).join('\n\n'), { title: 'TEXTOS DO BOM DIA' })
    }

    if (action === 'mensagem') {
      const sub = normalize(args[1] || '')
      if (['reset', 'restaurar', 'padrao', 'padrão'].includes(sub)) {
        updateGlobalMorningConfig({ messages: [...GLOBAL_MORNING_DEFAULT_MESSAGES] })
        return reply(sock, msg, 'Mensagens variadas restauradas.')
      }
      if (['remover', 'del', 'delete'].includes(sub)) {
        const index = Number(args[2]) - 1
        if (!Number.isInteger(index) || !config.messages[index]) return reply(sock, msg, 'Informe o número exibido em .bomdiaglobal mensagens.')
        const messages = config.messages.filter((_, itemIndex) => itemIndex !== index)
        updateGlobalMorningConfig({ messages })
        return reply(sock, msg, 'Mensagem removida.')
      }
      const body = String(rawArgs || '').replace(/^\S+\s+/, '').replace(/^\S+\s*/, '').trim()
      if (body.length < 5 || body.length > 900) return reply(sock, msg, `Use ${settings.prefix}bomdiaglobal mensagem adicionar <texto>.`)
      const messages = [...config.messages, body].slice(-30)
      updateGlobalMorningConfig({ messages })
      return reply(sock, msg, `Mensagem adicionada. Total: ${messages.length}.`)
    }

    if (['ignorar', 'grupo'].includes(action)) {
      if (!isGroup) return reply(sock, msg, 'Use essa opção dentro do grupo desejado.')
      const mode = normalize(args[1] || 'status')
      if (mode === 'status') return reply(sock, msg, `Bom dia global neste grupo: ${isGlobalMorningDisabledForGroup(msg.key.remoteJid) ? 'ignorado' : 'ativo'}.`)
      const disabled = onWords.has(mode) ? true : offWords.has(mode) ? false : null
      if (disabled == null) return reply(sock, msg, `Use ${settings.prefix}bomdiaglobal ignorar on ou off.`)
      setGlobalMorningGroupDisabled(msg.key.remoteJid, disabled)
      writeAudit({ actor: senderNumber, action: 'automation.global-morning.group', chat: msg.key.remoteJid, details: { disabled } })
      return reply(sock, msg, disabled ? 'Este grupo será ignorado pelo bom dia global.' : 'Este grupo voltou a receber o bom dia global.')
    }

    if (['testar', 'teste'].includes(action)) {
      if (!isGroup) return reply(sock, msg, 'Execute o teste dentro de um grupo.')
      try {
        const result = await testGlobalMorningNow(sock, msg.key.remoteJid, logger)
        return reply(sock, msg, `Teste concluído para ${result.participants || 0} participante(s).`)
      } catch (error) { return reply(sock, msg, `Teste não concluído: ${error.message}`) }
    }

    return reply(sock, msg, [
      `${settings.prefix}bomdiaglobal on|off`,
      `${settings.prefix}bomdiaglobal hora 09:00`,
      `${settings.prefix}bomdiaglobal fuso America/Recife`,
      `${settings.prefix}bomdiaglobal audio (respondendo um áudio)`,
      `${settings.prefix}bomdiaglobal audio padrao|off`,
      `${settings.prefix}bomdiaglobal mensagens`,
      `${settings.prefix}bomdiaglobal mensagem adicionar <texto>`,
      `${settings.prefix}bomdiaglobal mensagem remover <número>`,
      `${settings.prefix}bomdiaglobal ignorar on|off`,
      `${settings.prefix}bomdiaglobal testar`
    ].join('\n'), { title: 'BOM DIA GLOBAL' })
  }
})
