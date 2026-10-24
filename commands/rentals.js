import { defineCommand } from '../data/workstation.js'
import { cancelRental, getRental, listRentals, renewRental, rentalHistory, setRentalDuration } from '../data/rentals.js'
import { expiryDateLabel, formatRemaining, parseDuration } from '../data/duration.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { writeAudit } from '../data/core-store.js'
import { hasPermission, PERMISSIONS } from '../data/permissions.js'
import { groupDisplayName } from '../data/user-display.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const validDuration = value => parseDuration(value, { defaultUnit: 'dia', minMs: 60_000, maxMs: 5 * 365 * 86_400_000 })

function statusLines(row, groupName) {
  return [
    `grupo: ${groupName}`,
    `status: ${row?.valid ? 'contrato ativo' : row?.active === false ? 'contrato cancelado' : 'sem contrato ativo'}`,
    row ? `tempo restante: ${formatRemaining(row)}` : '',
    row?.expiresAt ? `vencimento: ${expiryDateLabel(row.expiresAt)}` : '',
    row?.startedAt ? `início: ${expiryDateLabel(row.startedAt)}` : '',
    row?.permanent ? 'modalidade: vitalício' : ''
  ].filter(Boolean)
}

async function panel({ sock, msg, row, logger, settings }) {
  const groupName = await groupDisplayName(sock, msg.key.remoteJid)
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'contract-panel',
    body: formatMessage(statusLines(row, groupName).join('\n'), { title: 'CONTRATO DO GRUPO' }),
    buttonText: '💮 Opções de contrato',
    sections: [{ title: 'Ativar ou substituir', rows: [
      { id: `${settings.prefix}c 15d`, title: '💮 Ativar 15 dias', description: 'Dono ou subdono' },
      { id: `${settings.prefix}c 30d`, title: '🌸 Ativar 30 dias', description: 'Dono ou subdono' },
      { id: `${settings.prefix}c vitalicio`, title: '💮 Ativar vitalício', description: 'Sem data de vencimento' }
    ] }, { title: 'Gerenciamento', rows: [
      { id: `${settings.prefix}c renovar 30d`, title: '🌸 Renovar por 30 dias', description: 'Soma tempo ao vencimento atual' },
      { id: `${settings.prefix}c historico`, title: '🌸 Histórico', description: 'Últimas alterações do contrato' },
      { id: `${settings.prefix}c cancelar`, title: '🌸 Cancelar contrato', description: 'Preserva o histórico e bloqueia a Sakura' }
    ] }]
  })
}

export default defineCommand({
  name: 'contrato',
  aliases: ['c', 'ctt', 'contratos', 'grupoalugado', 'aluguel', 'tempoaluguel', 'addaluguel', 'alugar', 'removeraluguel', 'delaluguel', 'listaaluguel'],
  menuEntries: [
    { name: 'contrato', usage: '.contrato', description: 'Consulta ou ativa o contrato deste grupo.', menuGroup: 'Contratos' },
    { name: 'contratos', usage: '.contratos', description: 'Lista contratos ativos.', menuGroup: 'Dono' }
  ],
  category: 'Aluguel',
  usage: '.c 30d | .c renovar 2h | .c vitalicio',
  groupOnly: false,
  async execute({ sock, msg, args, text, settings, isOwner, isSubowner, role, isGroup, senderNumber, logger }) {
    const used = normalize(text.slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const effectiveRole = role || (isOwner ? 'owner' : isSubowner ? 'subowner' : 'member')
    if (used === 'contratos' || used === 'listaaluguel') {
      if (!hasPermission(effectiveRole, PERMISSIONS.CONTRACTS)) return reply(sock, msg, 'Apenas dono ou subdono pode listar contratos.')
      const rows = await listRentals({ activeOnly: true })
      const namedRows = await Promise.all(rows.map(async row => ({ ...row, groupName: await groupDisplayName(sock, row.chat) })))
      const body = namedRows.map((row, index) => `${index + 1}. ${row.groupName}\n   ${formatRemaining(row)}${row.expiresAt ? ` • ${expiryDateLabel(row.expiresAt)}` : ''}`).join('\n')
      return reply(sock, msg, body || 'Nenhum contrato ativo.', { title: 'CONTRATOS' })
    }
    if (!isGroup) return reply(sock, msg, 'Use este comando dentro do grupo que receberá o contrato.')
    const chat = msg.key.remoteJid
    const action = normalize(args[0])
    if (!action) return panel({ sock, msg, row: await getRental(chat), logger, settings })

    if (['historico', 'histórico', 'history'].includes(action)) {
      if (!hasPermission(effectiveRole, PERMISSIONS.CONTRACTS)) return reply(sock, msg, 'Apenas dono ou subdono pode consultar o histórico completo.')
      const rows = await rentalHistory(chat, 15)
      const labels = { set: 'ativado', renew: 'renovado', cancelled: 'cancelado', removed: 'removido', expired: 'expirado' }
      const body = rows.map((row, index) => {
        const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Recife' }).format(new Date(row.at))
        return `${index + 1}. ${labels[row.type] || row.type} • ${when}${row.actor ? ` • +${row.actor}` : ''}`
      }).join('\n')
      return reply(sock, msg, body || 'Nenhuma alteração registrada.', { title: 'HISTÓRICO DO CONTRATO' })
    }

    if (!hasPermission(effectiveRole, PERMISSIONS.CONTRACTS)) return reply(sock, msg, 'Apenas dono ou subdono pode alterar contratos.')
    if (['remover', 'remove', 'del', 'off', 'cancelar', 'cancel'].includes(action) || ['removeraluguel', 'delaluguel'].includes(used)) {
      const old = await cancelRental(chat, senderNumber, 'cancelled')
      writeAudit({ actor: senderNumber, action: 'contract.cancel', target: chat, chat })
      return reply(sock, msg, old ? 'Contrato cancelado. O histórico foi preservado e a Sakura ficará silenciosa neste grupo.' : 'Este grupo não possuía contrato registrado.', { title: 'CONTRATO' })
    }

    const renewing = ['renovar', 'renew', 'estender'].includes(action)
    const rawDuration = renewing ? args[1] : args[0]
    const duration = validDuration(rawDuration)
    if (!duration) return reply(sock, msg, `Duração inválida. Exemplos: *${settings.prefix}c 30d*, *${settings.prefix}c 2h*, *${settings.prefix}c 45m*, *${settings.prefix}c 2meses* ou *${settings.prefix}c vitalicio*.`, { title: 'CONTRATO' })

    const row = renewing
      ? await renewRental(chat, duration, senderNumber)
      : await setRentalDuration(chat, duration, senderNumber, { mode: 'set' })
    writeAudit({ actor: senderNumber, action: renewing ? 'contract.renew' : 'contract.set', target: chat, chat, details: { duration: duration.label, permanent: duration.permanent, expiresAt: row.expiresAt } })
    return reply(sock, msg, [
      renewing ? 'Contrato renovado.' : 'Contrato ativado.',
      `Duração aplicada: ${duration.label}.`,
      `Tempo restante: ${formatRemaining(row)}.`,
      row.expiresAt ? `Vencimento: ${expiryDateLabel(row.expiresAt)}.` : 'Vencimento: vitalício.'
    ].join('\n'), { title: 'CONTRATO' })
  }
})
