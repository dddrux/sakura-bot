import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'
import { sendNativeList, sendQuickButtons } from '../data/interactive.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { writeAudit } from '../data/core-store.js'
import {
  clearFloodState,
  getAutomationConfig,
  updateAutomationConfig
} from '../data/automation-store.js'
import { removeCustomDailyAudio, saveDailyAudioFromMessage } from '../data/automation-media.js'
import { testDailyAutomationNow } from '../data/group-automations.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])
const state = value => value ? 'ligado' : 'desligado'
const seconds = ms => `${Math.round(Number(ms || 0) / 1000)}s`

function boolArg(value) {
  const word = normalize(value)
  if (onWords.has(word)) return true
  if (offWords.has(word)) return false
  return null
}

function invoked(text, prefix) {
  return normalize(String(text || '').slice(prefix.length).trim().split(/\s+/, 1)[0])
}

function mentionedNumber(msg, args = []) {
  const context = getContextInfo(msg?.message)
  const jid = firstTargetJid(msg, args)
  return String(jid || args.find(value => /\d{8,}/.test(String(value || ''))) || '').replace(/\D/g, '')
}

function statusLines(config) {
  return [
    `boas-vindas: ${state(config.welcomeEnabled)}`,
    `TikTok automático: ${state(config.tiktokAutoEnabled)}`,
    `Instagram/Pinterest automático: ${state(config.socialAutoEnabled)}`,
    `AutoDownload de qualquer link: ${state(config.autoDownloadEnabled)}`,
    `rotina diária: ${state(config.dailyEnabled)} • ${config.dailyTime} • ${config.dailyTimezone}`,
    `áudio diário: ${config.dailyAudioPath === 'off' ? 'desligado' : config.dailyAudioPath.startsWith('custom/') ? 'personalizado' : 'acorda padrão'}`,
    `horário silencioso: ${state(config.quietHoursEnabled)} • ${config.quietHoursStart}–${config.quietHoursEnd} • ${config.quietHoursTimezone}`,
    `antiflood: ${state(config.antifloodEnabled)}`,
    `limite por usuário: ${config.antifloodUserLimit} ponto(s) em ${seconds(config.antifloodWindowMs)}`,
    `limite do grupo: ${config.antifloodGroupLimit} ponto(s)`,
    `bloqueio inicial: ${seconds(config.antifloodBaseBlockMs)}`,
    `administradores: limite ×${config.antifloodAdminMultiplier}`,
    `subdonos: limite ×${config.antifloodSubownerMultiplier}`
  ]
}

async function panel({ sock, msg, settings, logger, config }) {
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'group-automations-panel',
    body: formatMessage(statusLines(config).join('\n'), { title: 'AUTOMAÇÕES DO GRUPO', icon: '💮' }),
    buttonText: 'Configurar',
    sections: [{
      title: 'Ativação rápida',
      rows: [
        { id: `${settings.prefix}boasvindas ${config.welcomeEnabled ? 'off' : 'on'}`, title: `${config.welcomeEnabled ? '🌸' : '🌸'} ${config.welcomeEnabled ? 'Desligar' : 'Ligar'} boas-vindas`, description: 'Agrupa pessoas que entrarem juntas' },
        { id: `${settings.prefix}tiktokauto ${config.tiktokAutoEnabled ? 'off' : 'on'}`, title: `${config.tiktokAutoEnabled ? '🌸' : '💮'} ${config.tiktokAutoEnabled ? 'Desligar' : 'Ligar'} TikTok automático`, description: 'Baixa links válidos sem comando' },
        { id: `${settings.prefix}autodownload ${config.autoDownloadEnabled ? 'off' : 'on'}`, title: `${config.autoDownloadEnabled ? '🌸' : '💮'} ${config.autoDownloadEnabled ? 'Desativar' : 'Ativar'} AutoDownload`, description: 'Tenta baixar mídia de qualquer link público' },
        { id: `${settings.prefix}autodl ${config.socialAutoEnabled ? 'off' : 'on'}`, title: `${config.socialAutoEnabled ? '🌸' : '💮'} ${config.socialAutoEnabled ? 'Desativar' : 'Ativar'} Instagram/Pinterest`, description: 'Baixa links públicos sem comando' },
        { id: `${settings.prefix}rotina8 ${config.dailyEnabled ? 'off' : 'on'}`, title: `${config.dailyEnabled ? '🌸' : '💮'} ${config.dailyEnabled ? 'Desligar' : 'Ligar'} rotina diária`, description: `${config.dailyTime} em ${config.dailyTimezone}` },
        { id: `${settings.prefix}horariosilencioso ${config.quietHoursEnabled ? 'off' : 'on'}`, title: `${config.quietHoursEnabled ? '💮' : '💮'} ${config.quietHoursEnabled ? 'Desligar' : 'Ligar'} horário silencioso`, description: `${config.quietHoursStart}–${config.quietHoursEnd}` },
        { id: `${settings.prefix}antiflood ${config.antifloodEnabled ? 'off' : 'on'}`, title: `${config.antifloodEnabled ? '🌸' : '🌸'} ${config.antifloodEnabled ? 'Desligar' : 'Ligar'} antiflood`, description: 'Afeta somente comandos' }
      ]
    }, {
      title: 'Ajustes e testes',
      rows: [
        { id: `${settings.prefix}rotina8 testar`, title: '🌸 Testar rotina agora', description: 'Envia mensagem, marcações e áudio' },
        { id: `${settings.prefix}antiflood status`, title: '🌸 Ver limites do antiflood', description: 'Mostra janela, limites e bloqueio' },
        { id: `${settings.prefix}automacoes ajuda`, title: '🌸 Ver todos os comandos', description: 'Mensagens, horários, áudio e limites' }
      ]
    }]
  })
}

async function togglePanel({ sock, msg, settings, logger, command, title, icon, enabled, description, statusDescription = 'Mostra o estado e os detalhes atuais' }) {
  return sendQuickButtons({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: `${command}-toggle`,
    body: formatMessage([
      `Estado atual: *${enabled ? 'ATIVADO' : 'DESATIVADO'}*`,
      '', description, '', statusDescription
    ].join('\n'), { title, icon }),
    includeUpdateCta: false,
    buttons: [
      { id: `${settings.prefix}${command} on`, text: '🌸 Ativar' },
      { id: `${settings.prefix}${command} off`, text: '💮 Desativar' },
      { id: `${settings.prefix}${command} status`, text: '🪷 Ver estado' }
    ]
  })
}

export default defineCommand({
  name: 'automacoes',
  aliases: ['auto', 'automacao', 'autogrupo', 'boasvindas', 'welcome', 'tiktokauto', 'autotiktok', 'autodownload', 'autobaixar', 'autolink', 'autodl', 'socialauto', 'instaauto', 'pinauto', 'rotina8', 'bomdiaauto', 'horariosilencioso', 'silencioso', 'quiet', 'antiflood', 'flood'],
  menuEntries: [
    { name: 'automacoes', usage: '.automacoes', description: 'Configura as automações deste grupo.', menuGroup: 'Configuração' },
    { name: 'boasvindas', usage: '.boasvindas on', description: 'Ativa boas-vindas agrupadas.', menuGroup: 'Administração' },
    { name: 'tiktokauto', usage: '.tiktokauto on', description: 'Ativa download automático de TikTok.', menuGroup: 'Administração' },
    { name: 'autodownload', usage: '.autodownload', description: 'Ativa download automático de mídia em links públicos.', menuGroup: 'Administração' },
    { name: 'autodl', usage: '.autodl', description: 'Ativa Instagram e Pinterest automáticos.', menuGroup: 'Administração' },
    { name: 'rotina8', usage: '.rotina8 on', description: 'Configura mensagem e áudio diários.', menuGroup: 'Administração' },
    { name: 'horariosilencioso', usage: '.horariosilencioso 22:00 07:00', description: 'Pausa automações durante a madrugada.', menuGroup: 'Administração' },
    { name: 'antiflood', usage: '.antiflood status', description: 'Configura proteção contra flood de comandos.', menuGroup: 'Administração' }
  ],
  category: 'Administração',
  usage: '.automacoes',
  groupOnly: true,
  adminOnly: true,
  needsMetadata: true,
  async execute({ sock, msg, args, rawArgs, text, settings, senderNumber, logger }) {
    const used = invoked(text, settings.prefix)
    const config = getAutomationConfig(msg.key.remoteJid)
    let section = used === 'automacoes' || used === 'automacao' || used === 'autogrupo' ? normalize(args[0]) : used
    let values = used === 'automacoes' || used === 'automacao' || used === 'autogrupo' ? args.slice(1) : args
    if (!section || section === 'status' || section === 'painel') return panel({ sock, msg, settings, logger, config })

    if (section === 'boasvindas' || section === 'welcome') {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'boasvindas', title: 'BOAS-VINDAS', icon: '🌸', enabled: config.welcomeEnabled, description: 'Agrupa e recebe as pessoas que entrarem no grupo.' })
      const action = normalize(values[0])
      const enabled = boolArg(action)
      if (enabled != null) {
        const next = updateAutomationConfig(msg.key.remoteJid, { welcomeEnabled: enabled })
        writeAudit({ actor: senderNumber, action: 'automation.welcome', chat: msg.key.remoteJid, details: { enabled } })
        return reply(sock, msg, `Boas-vindas agrupadas ${state(next.welcomeEnabled)}.`, { title: 'BOAS-VINDAS' })
      }
      if (action === 'status') return reply(sock, msg, `Boas-vindas: *${state(config.welcomeEnabled)}*.`, { title: 'BOAS-VINDAS' })
      if (['mensagem', 'texto'].includes(action)) {
        const body = values.slice(1).join(' ').trim()
        if (body.length < 5 || body.length > 700) return reply(sock, msg, 'A mensagem precisa ter entre 5 e 700 caracteres.')
        updateAutomationConfig(msg.key.remoteJid, { welcomeMessage: body })
        writeAudit({ actor: senderNumber, action: 'automation.welcome.message', chat: msg.key.remoteJid, details: { length: body.length } })
        return reply(sock, msg, 'Mensagem de boas-vindas atualizada sem alterar as marcações automáticas.')
      }
      return reply(sock, msg, [`${settings.prefix}boasvindas on|off`, `${settings.prefix}boasvindas mensagem <texto>`].join('\n'), { title: 'BOAS-VINDAS' })
    }

    if (section === 'autodownload' || section === 'autobaixar' || section === 'autolink') {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'autodownload', title: 'AUTODOWNLOAD', icon: '💮', enabled: config.autoDownloadEnabled, description: 'Tenta baixar automaticamente mídia de qualquer link público enviado no chat. URLs locais/privadas são bloqueadas.' })
      if (normalize(values[0]) === 'status') return reply(sock, msg, `AutoDownload: *${state(config.autoDownloadEnabled)}*.`, { title: 'AUTODOWNLOAD' })
      const enabled = boolArg(values[0])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}autodownload on|off.`)
      const next = updateAutomationConfig(msg.key.remoteJid, { autoDownloadEnabled: enabled })
      writeAudit({ actor: senderNumber, action: 'automation.auto-download', chat: msg.key.remoteJid, details: { enabled } })
      return reply(sock, msg, `AutoDownload ${state(next.autoDownloadEnabled)}.`)
    }

    if (section === 'tiktokauto' || section === 'autotiktok') {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'tiktokauto', title: 'TIKTOK AUTOMÁTICO', icon: '💮', enabled: config.tiktokAutoEnabled, description: 'Baixa links públicos do TikTok enviados no grupo sem precisar de comando.' })
      if (normalize(values[0]) === 'status') return reply(sock, msg, `TikTok automático: *${state(config.tiktokAutoEnabled)}*.`, { title: 'TIKTOK AUTOMÁTICO' })
      const enabled = boolArg(values[0])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}tiktokauto on ou off.`)
      const next = updateAutomationConfig(msg.key.remoteJid, { tiktokAutoEnabled: enabled })
      writeAudit({ actor: senderNumber, action: 'automation.tiktok', chat: msg.key.remoteJid, details: { enabled } })
      return reply(sock, msg, `TikTok automático ${state(next.tiktokAutoEnabled)}. Links repetidos e filas excessivas serão ignorados.`, { title: 'TIKTOK AUTOMÁTICO' })
    }

    if (['autodl', 'socialauto', 'instaauto', 'pinauto'].includes(section)) {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'autodl', title: 'DOWNLOAD AUTOMÁTICO', icon: '🌸', enabled: config.socialAutoEnabled, description: 'Baixa links públicos do Instagram e Pinterest diretamente, sem yt-dlp.' })
      if (normalize(values[0]) === 'status') return reply(sock, msg, `Instagram/Pinterest automático: *${state(config.socialAutoEnabled)}*.`, { title: 'DOWNLOAD AUTOMÁTICO' })
      const enabled = boolArg(values[0])
      if (enabled == null) return reply(sock, msg, `Use ${settings.prefix}autodl on ou off.`)
      const next = updateAutomationConfig(msg.key.remoteJid, { socialAutoEnabled: enabled })
      writeAudit({ actor: senderNumber, action: 'automation.social-download', chat: msg.key.remoteJid, details: { enabled } })
      return reply(sock, msg, `Instagram e Pinterest automáticos ${state(next.socialAutoEnabled)}. Links repetidos são ignorados e a fila é limitada para não pesar no host.`, { title: 'DOWNLOAD AUTOMÁTICO' })
    }

    if (section === 'rotina8' || section === 'bomdiaauto') {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'rotina8', title: 'ROTINA DIÁRIA', icon: '💮', enabled: config.dailyEnabled, description: `Envia a rotina às ${config.dailyTime} no fuso ${config.dailyTimezone}.`, statusDescription: 'Mostra horário, fuso, mensagem e áudio' })
      const action = normalize(values[0])
      const enabled = boolArg(action)
      if (enabled != null) {
        const next = updateAutomationConfig(msg.key.remoteJid, { dailyEnabled: enabled })
        writeAudit({ actor: senderNumber, action: 'automation.daily', chat: msg.key.remoteJid, details: { enabled } })
        return reply(sock, msg, `Rotina diária ${state(next.dailyEnabled)}. Horário atual: ${next.dailyTime} (${next.dailyTimezone}).`, { title: 'ROTINA DIÁRIA' })
      }
      if (action === 'status') return reply(sock, msg, statusLines(config).slice(3, 5).join('\n'), { title: 'ROTINA DIÁRIA' })
      if (['hora', 'horario', 'horário'].includes(action)) {
        const next = updateAutomationConfig(msg.key.remoteJid, { dailyTime: values[1] })
        writeAudit({ actor: senderNumber, action: 'automation.daily.time', chat: msg.key.remoteJid, details: { time: next.dailyTime } })
        return reply(sock, msg, `Horário diário alterado para ${next.dailyTime}.`)
      }
      if (['fuso', 'timezone'].includes(action)) {
        try {
          const next = updateAutomationConfig(msg.key.remoteJid, { dailyTimezone: values[1] })
          writeAudit({ actor: senderNumber, action: 'automation.daily.timezone', chat: msg.key.remoteJid, details: { timezone: next.dailyTimezone } })
          return reply(sock, msg, `Fuso da rotina alterado para ${next.dailyTimezone}.`)
        } catch (error) { return reply(sock, msg, error.message) }
      }
      if (['mensagem', 'texto'].includes(action)) {
        const body = values.slice(1).join(' ').trim()
        if (body.length < 5 || body.length > 900) return reply(sock, msg, 'A mensagem diária precisa ter entre 5 e 900 caracteres.')
        updateAutomationConfig(msg.key.remoteJid, { dailyMessage: body })
        writeAudit({ actor: senderNumber, action: 'automation.daily.message', chat: msg.key.remoteJid, details: { length: body.length } })
        return reply(sock, msg, 'Mensagem diária atualizada.')
      }
      if (action === 'audio') {
        const mode = normalize(values[1])
        if (['off', 'desligar', 'sem'].includes(mode)) {
          await removeCustomDailyAudio(config.dailyAudioPath)
          updateAutomationConfig(msg.key.remoteJid, { dailyAudioPath: 'off' })
          return reply(sock, msg, 'Áudio da rotina diária desligado.')
        }
        if (['padrao', 'padrão', 'acorda', 'restaurar'].includes(mode)) {
          await removeCustomDailyAudio(config.dailyAudioPath)
          updateAutomationConfig(msg.key.remoteJid, { dailyAudioPath: 'legacy/acorda.mp3' })
          return reply(sock, msg, 'Áudio padrão “acorda” restaurado.')
        }
        try {
          const saved = await saveDailyAudioFromMessage({ msg, logger })
          await removeCustomDailyAudio(config.dailyAudioPath)
          updateAutomationConfig(msg.key.remoteJid, { dailyAudioPath: saved.relative })
          writeAudit({ actor: senderNumber, action: 'automation.daily.audio', chat: msg.key.remoteJid, details: { sizeBytes: saved.sizeBytes } })
          return reply(sock, msg, `Áudio diário personalizado salvo (${(saved.sizeBytes / 1024 / 1024).toFixed(2)} MB).`)
        } catch (error) { return reply(sock, msg, error.message) }
      }
      if (['testar', 'teste'].includes(action)) {
        try {
          const result = await testDailyAutomationNow(sock, msg.key.remoteJid, logger)
          return reply(sock, msg, `Teste concluído para ${result.participants} participante(s). Áudio: ${result.audio ? 'enviado' : 'desligado/indisponível'}.`)
        } catch (error) { return reply(sock, msg, `Não foi possível testar: ${error.message}`) }
      }
      return reply(sock, msg, [
        `${settings.prefix}rotina8 on|off`,
        `${settings.prefix}rotina8 hora 08:00`,
        `${settings.prefix}rotina8 fuso America/Recife`,
        `${settings.prefix}rotina8 mensagem <texto>`,
        `${settings.prefix}rotina8 audio (respondendo áudio)`,
        `${settings.prefix}rotina8 audio padrao|off`,
        `${settings.prefix}rotina8 testar`
      ].join('\n'), { title: 'ROTINA DIÁRIA' })
    }

    if (section === 'horariosilencioso' || section === 'silencioso' || section === 'quiet') {
      if (!values.length) return togglePanel({
        sock,
        msg,
        settings,
        logger,
        command: 'horariosilencioso',
        title: 'HORÁRIO SILENCIOSO',
        icon: '💮',
        enabled: config.quietHoursEnabled,
        description: `Pausa boas-vindas, downloads automáticos e rotinas entre ${config.quietHoursStart} e ${config.quietHoursEnd} (${config.quietHoursTimezone}).`,
        statusDescription: 'Mostra início, fim e fuso configurados'
      })
      const action = normalize(values[0])
      const enabled = boolArg(action)
      if (enabled != null) {
        const next = updateAutomationConfig(msg.key.remoteJid, { quietHoursEnabled: enabled })
        writeAudit({ actor: senderNumber, action: 'automation.quiet-hours.toggle', chat: msg.key.remoteJid, details: { enabled } })
        return reply(sock, msg, `Horário silencioso ${state(next.quietHoursEnabled)}: ${next.quietHoursStart}–${next.quietHoursEnd} (${next.quietHoursTimezone}).`, { title: 'HORÁRIO SILENCIOSO' })
      }
      if (action === 'status') {
        return reply(sock, msg, `Estado: *${state(config.quietHoursEnabled)}*
Período: *${config.quietHoursStart}–${config.quietHoursEnd}*
Fuso: *${config.quietHoursTimezone}*`, { title: 'HORÁRIO SILENCIOSO' })
      }
      if (action === 'fuso' || action === 'timezone') {
        try {
          const next = updateAutomationConfig(msg.key.remoteJid, { quietHoursTimezone: values[1] })
          writeAudit({ actor: senderNumber, action: 'automation.quiet-hours.timezone', chat: msg.key.remoteJid, details: { timezone: next.quietHoursTimezone } })
          return reply(sock, msg, `Fuso do horário silencioso alterado para *${next.quietHoursTimezone}*.`)
        } catch (error) { return reply(sock, msg, error.message) }
      }
      const start = values[0]
      const end = values[1]
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
        if (start === end) return reply(sock, msg, 'O início e o fim precisam ser diferentes para evitar silêncio de 24 horas.')
        try {
          const next = updateAutomationConfig(msg.key.remoteJid, {
            quietHoursEnabled: true,
            quietHoursStart: start,
            quietHoursEnd: end,
            quietHoursTimezone: values[2] || config.quietHoursTimezone
          })
          writeAudit({ actor: senderNumber, action: 'automation.quiet-hours.configure', chat: msg.key.remoteJid, details: { start, end, timezone: next.quietHoursTimezone } })
          return reply(sock, msg, `Horário silencioso ativado das *${next.quietHoursStart}* às *${next.quietHoursEnd}* (${next.quietHoursTimezone}).`, { title: 'HORÁRIO SILENCIOSO' })
        } catch (error) { return reply(sock, msg, error.message) }
      }
      return reply(sock, msg, [
        `${settings.prefix}horariosilencioso 22:00 07:00`,
        `${settings.prefix}horariosilencioso 22:00 07:00 America/Recife`,
        `${settings.prefix}horariosilencioso on|off|status`,
        `${settings.prefix}horariosilencioso fuso America/Recife`
      ].join('\n'), { title: 'HORÁRIO SILENCIOSO' })
    }

    if (section === 'antiflood' || section === 'flood') {
      if (!values.length) return togglePanel({ sock, msg, settings, logger, command: 'antiflood', title: 'ANTIFLOOD', icon: '🌸', enabled: config.antifloodEnabled, description: 'Reduz spam de comandos com limites progressivos por usuário e por grupo.', statusDescription: 'Mostra janela, limites e bloqueios' })
      const action = normalize(values[0])
      const enabled = boolArg(action)
      if (enabled != null) {
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodEnabled: enabled })
        writeAudit({ actor: senderNumber, action: 'automation.antiflood', chat: msg.key.remoteJid, details: { enabled } })
        return reply(sock, msg, `Antiflood de comandos ${state(next.antifloodEnabled)}.`)
      }
      if (action === 'status') return reply(sock, msg, statusLines(config).slice(6).join('\n'), { title: 'ANTIFLOOD' })
      if (['limite', 'usuario', 'usuário'].includes(action)) {
        const value = Number(values[1])
        if (!Number.isInteger(value) || value < 2 || value > 100) return reply(sock, msg, 'Escolha um limite entre 2 e 100 pontos.')
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodUserLimit: value })
        return reply(sock, msg, `Limite por usuário: ${next.antifloodUserLimit} pontos.`)
      }
      if (action === 'grupo') {
        const value = Number(values[1])
        if (!Number.isInteger(value) || value < 5 || value > 500) return reply(sock, msg, 'Escolha um limite do grupo entre 5 e 500 pontos.')
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodGroupLimit: value })
        return reply(sock, msg, `Limite coletivo: ${next.antifloodGroupLimit} pontos.`)
      }
      if (['janela', 'intervalo'].includes(action)) {
        const value = Number(values[1])
        if (!Number.isFinite(value) || value < 3 || value > 120) return reply(sock, msg, 'Escolha uma janela entre 3 e 120 segundos.')
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodWindowMs: value * 1000 })
        return reply(sock, msg, `Janela do antiflood: ${seconds(next.antifloodWindowMs)}.`)
      }
      if (['bloqueio', 'punicao', 'punição'].includes(action)) {
        const value = Number(values[1])
        if (!Number.isFinite(value) || value < 5 || value > 1800) return reply(sock, msg, 'Escolha o bloqueio inicial entre 5 e 1800 segundos.')
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodBaseBlockMs: value * 1000 })
        return reply(sock, msg, `Bloqueio inicial: ${seconds(next.antifloodBaseBlockMs)}. Reincidências aumentam progressivamente.`)
      }
      if (action === 'admin') {
        const value = Number(values[1])
        if (!Number.isInteger(value) || value < 1 || value > 10) return reply(sock, msg, 'Escolha um multiplicador de administrador entre 1 e 10.')
        const next = updateAutomationConfig(msg.key.remoteJid, { antifloodAdminMultiplier: value })
        return reply(sock, msg, `Limite dos administradores: ×${next.antifloodAdminMultiplier}.`)
      }
      if (action === 'reset' || action === 'limpar') {
        const target = mentionedNumber(msg, values.slice(1))
        clearFloodState(msg.key.remoteJid, target)
        return reply(sock, msg, target ? `Punição e contadores de @${target} removidos.` : 'Contadores e punições do grupo removidos.', { mentions: target ? [`${target}@s.whatsapp.net`] : [] })
      }
      return reply(sock, msg, [
        `${settings.prefix}antiflood on|off`,
        `${settings.prefix}antiflood limite 6`,
        `${settings.prefix}antiflood grupo 30`,
        `${settings.prefix}antiflood janela 10`,
        `${settings.prefix}antiflood bloqueio 15`,
        `${settings.prefix}antiflood admin 2`,
        `${settings.prefix}antiflood reset [@pessoa]`
      ].join('\n'), { title: 'ANTIFLOOD' })
    }

    if (section === 'ajuda') return reply(sock, msg, [
      `${settings.prefix}boasvindas on|off`,
      `${settings.prefix}boasvindas mensagem <texto>`,
      `${settings.prefix}tiktokauto on|off`,
      `${settings.prefix}autodownload on|off`,
      `${settings.prefix}autodl on|off`,
      `${settings.prefix}rotina8 on|off`,
      `${settings.prefix}rotina8 hora HH:MM`,
      `${settings.prefix}rotina8 mensagem <texto>`,
      `${settings.prefix}rotina8 audio`,
      `${settings.prefix}horariosilencioso 22:00 07:00`,
      `${settings.prefix}antiflood status`
    ].join('\n'), { title: 'AUTOMAÇÕES' })

    return panel({ sock, msg, settings, logger, config })
  }
})
