import { defineCommand } from '../data/workstation.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { cancelVip, getVip, listVips, renewVip, setVipDuration, vipBenefits, vipHistory } from '../data/vip.js'
import { expiryDateLabel, formatRemaining, parseDuration } from '../data/duration.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { writeAudit } from '../data/core-store.js'
import { hasPermission, PERMISSIONS } from '../data/permissions.js'
import { groupNameMap, displayUser, formatMentionName } from '../data/user-display.js'

const digits = value => String(value || '').replace(/\D/g, '')
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const validDuration = value => parseDuration(value, { defaultUnit: 'dia', minMs: 60_000, maxMs: 5 * 365 * 86_400_000 })
const bonusPercent = multiplier => Math.max(0, Math.round((Number(multiplier || 1) - 1) * 100))

function targetNumber(msg, args = [], senderNumber = '') {
  const context = getContextInfo(msg.message)
  const mentioned = firstTargetJid(msg, args)
  const direct = digits(mentioned) || digits(args.find(item => /\d{8,}/.test(String(item || ''))))
  return direct || digits(senderNumber)
}

async function sendVipPanel({ sock, msg, number, row, logger, settings }) {
  const benefits = vipBenefits(row?.plan)
  const body = [
    `celular: +${number}`,
    `status: ${row?.valid ? 'VIP ativo' : row?.active === false ? 'VIP cancelado' : 'plano gratuito'}`,
    row?.valid ? `plano: ${benefits.planName}` : 'plano: gratuito',
    row?.valid ? `tempo restante: ${formatRemaining(row)}` : 'tempo: sem assinatura ativa',
    row?.expiresAt ? `vencimento: ${expiryDateLabel(row.expiresAt)}` : row?.permanent ? 'vencimento: vitalício' : '',
    `downloads: ${row?.valid ? benefits.mediaLimitMb : benefits.freeMediaLimitMb} MB`,
    row?.valid ? `prioridade: ${benefits.priorityMultiplier}x na fila VIP` : 'prioridade: fila padrão',
    row?.valid ? `economia: +${bonusPercent(benefits.dailyMultiplier)}% diário e +${bonusPercent(benefits.workMultiplier)}% trabalho` : 'economia: recompensas padrão'
  ].filter(Boolean).join('\n')

  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'vip-panel',
    body: formatMessage(body, { title: 'SAKURA VIP' }),
    buttonText: '💮 Opções VIP',
    sections: [{
      title: '🌸 Sakura VIP',
      rows: [
        { id: `${settings.prefix}vip`, title: '🌸 Atualizar meu plano', description: 'Consultar novamente o status VIP' },
        { id: `${settings.prefix}m mid`, title: '🌸 Abrir mídia', description: 'Play, TikTok e figurinhas' },
        { id: `${settings.prefix}m eco`, title: '💮 Abrir economia', description: 'Usar benefícios econômicos' }
      ]
    }]
  })
}

export default defineCommand({
  name: 'vip',
  aliases: ['v', 'vips', 'listavip', 'addvip', 'delvip'],
  category: 'VIP',
  usage: '.vip 30d @pessoa | .vip renovar 2h @pessoa | .vip vitalicio @pessoa',
  description: 'Consulta ou administra o Sakura VIP.',
  menuEntries: [
    { name: 'vip', usage: '.vip', description: 'Mostra status e benefícios VIP.', menuGroup: 'Conta' },
    { name: 'listavip', usage: '.listavip', description: 'Lista assinaturas VIP ativas.', menuGroup: 'Dono' }
  ],
  async execute({ sock, msg, args, text, settings, senderNumber, isOwner, isSubowner, role, logger }) {
    const used = normalize(text.slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const effectiveRole = role || (isOwner ? 'owner' : isSubowner ? 'subowner' : 'member')
    const action = normalize(args[0])

    if (['planos', 'plans', 'precos', 'preços'].includes(action)) {
      const rows = (settings.vipPlans || []).map(plan => ({
        id: `${settings.prefix}doar`,
        title: `💮 ${plan.name} • R$ ${Number(plan.price).toFixed(2).replace('.', ',')}`,
        description: `${plan.days} dias • ${plan.mediaLimitMb || settings.vipMediaLimitMb} MB • prioridade ${plan.priorityMultiplier || 1}x`
      }))
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'vip-plans',
        body: formatMessage('Escolha o plano que combina com você. Todos custam menos de R$ 15.', { title: 'PLANOS VIP' }),
        buttonText: '💮 Ver planos',
        sections: [{ title: '🪷 Planos Sakura', rows }, { title: '🪷 Apoiar', rows: [
          { id: `${settings.prefix}doar`, title: '🌸 Doação via PIX', description: 'Apoios também podem liberar benefícios' }
        ]}]
      })
    }

    if (used === 'listavip' || used === 'vips') {
      if (!hasPermission(effectiveRole, PERMISSIONS.VIP)) return reply(sock, msg, 'Apenas dono ou subdono pode listar assinaturas VIP.')
      const rows = await listVips()
      const names = msg.key.remoteJid?.endsWith('@g.us') ? await groupNameMap(sock, msg.key.remoteJid) : new Map()
      const mentions = []
      const body = rows.map((row, index) => {
        const user = displayUser(row.number, names)
        mentions.push(user.jid)
        return `${index + 1}. ${formatMentionName(user)} — ${formatRemaining(row)}${row.expiresAt ? ` • ${expiryDateLabel(row.expiresAt)}` : ''}`
      }).join('\n')
      return reply(sock, msg, body || 'Nenhuma assinatura VIP ativa.', { title: 'LISTA VIP', mentions: [...new Set(mentions)] })
    }

    if (action === 'historico' || action === 'histórico') {
      if (!hasPermission(effectiveRole, PERMISSIONS.VIP)) return reply(sock, msg, 'Apenas dono ou subdono pode consultar o histórico VIP.')
      const number = targetNumber(msg, args.slice(1), senderNumber)
      const rows = await vipHistory(number, 15)
      const labels = { set: 'ativado', renew: 'renovado', cancelled: 'cancelado', removed: 'removido', expired: 'expirado' }
      const body = rows.map((row, index) => {
        const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Recife' }).format(new Date(row.at))
        return `${index + 1}. ${labels[row.type] || row.type} • ${when}${row.actor ? ` • +${row.actor}` : ''}`
      }).join('\n')
      return reply(sock, msg, body || 'Nenhuma alteração VIP registrada.', { title: 'HISTÓRICO VIP' })
    }

    const modifying = Boolean(action) || used === 'addvip' || used === 'delvip'
    if (!modifying) {
      const number = targetNumber(msg, args, senderNumber)
      return sendVipPanel({ sock, msg, number, row: await getVip(number), logger, settings })
    }

    const knownOperation = ['renovar', 'renew', 'cancelar', 'remover', 'remove', 'del', 'off'].includes(action)
    const durationCandidate = validDuration(action)
    if (!knownOperation && !durationCandidate && used !== 'addvip' && used !== 'delvip') {
      const number = targetNumber(msg, args, senderNumber)
      return sendVipPanel({ sock, msg, number, row: await getVip(number), logger, settings })
    }

    if (!hasPermission(effectiveRole, PERMISSIONS.VIP)) return reply(sock, msg, 'Apenas dono ou subdono pode alterar assinaturas VIP.')

    if (['cancelar', 'remover', 'remove', 'del', 'off'].includes(action) || used === 'delvip') {
      const number = targetNumber(msg, used === 'delvip' ? args : args.slice(1), senderNumber)
      await cancelVip(number, senderNumber, 'cancelled')
      writeAudit({ actor: senderNumber, action: 'vip.cancel', target: number })
      return reply(sock, msg, `VIP de +${number} cancelado com histórico preservado.`, { title: 'SAKURA VIP' })
    }

    const renewing = ['renovar', 'renew'].includes(action)
    const rawDuration = renewing ? args[1] : used === 'addvip' && !durationCandidate ? '30d' : args[0]
    const duration = validDuration(rawDuration)
    if (!duration) return reply(sock, msg, `Duração inválida. Exemplos: *${settings.prefix}vip 30d @pessoa*, *${settings.prefix}vip renovar 2h @pessoa* ou *${settings.prefix}vip vitalicio @pessoa*.`)
    const targetArgs = used === 'addvip' && !durationCandidate ? args : args.slice(renewing ? 2 : 1)
    const number = targetNumber(msg, targetArgs, senderNumber)
    if (!number) return reply(sock, msg, `Use ${settings.prefix}vip 30d @pessoa.`)

    const row = renewing
      ? await renewVip(number, duration, senderNumber)
      : await setVipDuration(number, duration, senderNumber, { mode: 'set' })
    writeAudit({ actor: senderNumber, action: renewing ? 'vip.renew' : 'vip.set', target: number, details: { duration: duration.label, permanent: duration.permanent, expiresAt: row.expiresAt } })
    return reply(sock, msg, [
      `VIP ${renewing ? 'renovado' : 'ativado'} para +${number}.`,
      `Duração aplicada: ${duration.label}.`,
      `Tempo restante: ${formatRemaining(row)}.`,
      row.expiresAt ? `Vencimento: ${expiryDateLabel(row.expiresAt)}.` : 'Vencimento: vitalício.'
    ].join('\n'), { title: 'SAKURA VIP' })
  }
})
