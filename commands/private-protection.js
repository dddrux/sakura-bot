import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendQuickButtons } from '../data/interactive.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { writeAudit } from '../data/core-store.js'
import {
  addPrivateProtectionAllow,
  getPrivateProtectionConfig,
  listPrivateProtectionAllow,
  listPrivateProtectionAttempts,
  privateProtectionStatus,
  removePrivateProtectionAllow,
  resetPrivateProtection,
  updatePrivateProtectionConfig
} from '../data/private-protection.js'

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')
const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const jidFor = value => {
  const number = digits(value)
  return number ? `${number}@s.whatsapp.net` : ''
}
const onWords = new Set(['on', 'ativar', 'ligar', 'sim'])
const offWords = new Set(['off', 'desativar', 'desligar', 'nao'])

function targetFrom(msg, args = []) {
  const context = getContextInfo(msg?.message)
  const mentioned = firstTargetJid(msg, args)
  return jidFor(mentioned || args.find(value => /\d{8,}/.test(String(value || ''))))
}

function parseDuration(value) {
  const match = /^(\d{1,3})(m|h|d)$/i.exec(String(value || '').trim())
  if (!match) return 0
  const amount = Number(match[1])
  const factor = match[2].toLowerCase() === 'm' ? 60_000 : match[2].toLowerCase() === 'h' ? 60 * 60_000 : 24 * 60 * 60_000
  return amount * factor
}

function durationLabel(ms) {
  const days = ms / (24 * 60 * 60_000)
  if (Number.isInteger(days) && days >= 1) return `${days} dia(s)`
  const hours = ms / (60 * 60_000)
  if (Number.isInteger(hours) && hours >= 1) return `${hours} hora(s)`
  return `${Math.round(ms / 60_000)} minuto(s)`
}

function dateLabel(value) {
  return new Date(Number(value || 0)).toLocaleString('pt-BR', { timeZone: 'America/Recife' })
}

export default defineCommand({
  name: 'antipv',
  aliases: ['anti-pv', 'protecaopv', 'antichamada', 'antichamadas', 'anti-call'],
  category: 'Dono',
  ownerOnly: true,
  menuEntries: [
    { name: 'antipv', usage: '.antipv status', description: 'Gerencia avisos e bloqueios no privado.', menuGroup: 'Proteção do número' },
    { name: 'antichamada', usage: '.antichamada status', description: 'Gerencia recusas e bloqueios por chamadas.', menuGroup: 'Proteção do número' }
  ],

  async execute({ sock, msg, args, invokedAs, senderNumber }) {
    const used = normalize(invokedAs)
    const kind = used.includes('chamada') || used.includes('call') ? 'call' : 'message'
    const title = kind === 'call' ? 'ANTI-CHAMADAS' : 'ANTI-PV'
    const noAction = !String(args[0] || '').trim()
    const action = normalize(args[0] || 'status')
    const config = getPrivateProtectionConfig(kind)

    if (noAction) return sendQuickButtons({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: `${kind}-toggle`, includeUpdateCta: false,
      body: `${title}: escolha uma ação.`, buttons: [
        { id: `${settings.prefix}${kind === 'call' ? 'antichamada' : 'antipv'} on`, text: '🌸 Ativar' },
        { id: `${settings.prefix}${kind === 'call' ? 'antichamada' : 'antipv'} off`, text: '💮 Desativar' },
        { id: `${settings.prefix}${kind === 'call' ? 'antichamada' : 'antipv'} status`, text: '🪷 Ver estado' }
      ] })

    if (action === 'status') {
      const status = privateProtectionStatus()
      const current = status[kind]
      const rows = listPrivateProtectionAttempts(kind, 5)
      return reply(sock, msg, [
        `Estado: *${current.enabled ? 'ATIVADO' : 'DESATIVADO'}*`,
        `Bloqueio após: *${current.maxAttempts} tentativa(s)*`,
        `Janela: *${durationLabel(current.windowMs)}*`,
        `Contatos acompanhados: *${status.tracked}*`,
        `Bloqueios registrados: *${status.blocked}*`,
        `Contatos permitidos: *${status.allowed}*`,
        rows.length ? `\nÚltimas ocorrências:\n${rows.map(row => `• +${digits(row.jid)} — ${row.attempts} tentativa(s) — ${dateLabel(row.last_at)}`).join('\n')}` : ''
      ].filter(Boolean).join('\n'), { title })
    }

    if (onWords.has(action) || offWords.has(action)) {
      const enabled = onWords.has(action)
      const next = updatePrivateProtectionConfig(kind, { enabled }, senderNumber)
      writeAudit({ actor: senderNumber, action: `private-protection.${kind}.toggle`, details: { enabled } })
      return reply(sock, msg, `${title} *${next.enabled ? 'ativado' : 'desativado'}*.`)
    }

    if (action === 'limite') {
      const maxAttempts = Number(args[1])
      if (!Number.isInteger(maxAttempts) || maxAttempts < 2 || maxAttempts > 10) return reply(sock, msg, 'Use um limite entre 2 e 10 tentativas.')
      const next = updatePrivateProtectionConfig(kind, { maxAttempts }, senderNumber)
      writeAudit({ actor: senderNumber, action: `private-protection.${kind}.limit`, details: { maxAttempts } })
      return reply(sock, msg, `O bloqueio ocorrerá após *${next.maxAttempts} tentativa(s)*.`)
    }

    if (action === 'janela') {
      const windowMs = parseDuration(args[1])
      if (!windowMs) return reply(sock, msg, 'Use uma duração como *30m*, *12h*, *1d* ou *7d*.')
      const next = updatePrivateProtectionConfig(kind, { windowMs }, senderNumber)
      writeAudit({ actor: senderNumber, action: `private-protection.${kind}.window`, details: { windowMs } })
      return reply(sock, msg, `A janela de reincidência agora é de *${durationLabel(next.windowMs)}*.`)
    }

    if (action === 'tentativas' || action === 'historico') {
      const limit = Math.max(1, Math.min(50, Number(args[1]) || 20))
      const rows = listPrivateProtectionAttempts(kind, limit)
      return reply(sock, msg, rows.length ? rows.map((row, index) => [
        `${index + 1}. +${digits(row.jid)}`,
        `${row.attempts} tentativa(s) • ${row.blocked_at ? 'bloqueado' : 'não bloqueado'} • ${dateLabel(row.last_at)}`
      ].join('\n')).join('\n\n') : 'Nenhuma tentativa registrada.', { title })
    }

    if (action === 'permitidos' || action === 'whitelist') {
      const rows = listPrivateProtectionAllow()
      return reply(sock, msg, rows.length
        ? rows.map((row, index) => `${index + 1}. +${digits(row.jid)} • desde ${dateLabel(row.created_at)}`).join('\n')
        : 'A lista permitida está vazia.', { title: 'CONTATOS PERMITIDOS' })
    }

    const target = targetFrom(msg, args.slice(1))
    if (['reset', 'limpar', 'permitir', 'allow', 'remover', 'proibir', 'desbloquear'].includes(action) && !target) {
      return reply(sock, msg, `Marque ou informe o número. Ex.: *.${kind === 'call' ? 'antichamada' : 'antipv'} ${action} 5581...*`)
    }

    if (action === 'reset' || action === 'limpar') {
      const count = resetPrivateProtection(target, kind)
      writeAudit({ actor: senderNumber, action: `private-protection.${kind}.reset`, target: digits(target), details: { count } })
      return reply(sock, msg, `${count} registro(s) removido(s) para +${digits(target)}.`)
    }

    if (action === 'permitir' || action === 'allow') {
      addPrivateProtectionAllow(target, senderNumber, `Liberado por ${senderNumber}`)
      resetPrivateProtection(target)
      writeAudit({ actor: senderNumber, action: 'private-protection.allow', target: digits(target) })
      return reply(sock, msg, `+${digits(target)} foi adicionado à lista permitida.`, { title: 'CONTATO PERMITIDO' })
    }

    if (action === 'remover' || action === 'proibir') {
      const count = removePrivateProtectionAllow(target)
      writeAudit({ actor: senderNumber, action: 'private-protection.disallow', target: digits(target), details: { count } })
      return reply(sock, msg, count ? `+${digits(target)} foi removido da lista permitida.` : 'Esse contato não estava na lista permitida.')
    }

    if (action === 'desbloquear') {
      await sock.updateBlockStatus(target, 'unblock')
      resetPrivateProtection(target)
      writeAudit({ actor: senderNumber, action: 'private-protection.unblock', target: digits(target) })
      return reply(sock, msg, `+${digits(target)} foi desbloqueado e teve as tentativas zeradas.`)
    }

    return reply(sock, msg, [
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} status*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} on|off*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} limite 3*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} janela 1d*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} tentativas*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} reset 5581...*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} permitir 5581...*`,
      `*.${kind === 'call' ? 'antichamada' : 'antipv'} desbloquear 5581...*`
    ].join('\n'), { title })
  }
})
