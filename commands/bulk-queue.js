import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { writeAudit } from '../data/core-store.js'
import {
  bulkSendQueueStatus,
  cancelBulkSendJobs,
  clearBulkSendQueue,
  setBulkSendQueuePaused
} from '../data/bulk-send-queue.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

function ageLabel(value) {
  if (!value) return 'sem espera'
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`
}

export default defineCommand({
  name: 'filaenvios',
  aliases: ['statusfila', 'filamassa', 'pausarenvios', 'retomarenvios', 'limparfila'],
  category: 'Dono',
  ownerOnly: true,
  menuEntries: [
    { name: 'filaenvios', usage: '.filaenvios status', description: 'Consulta e controla envios automáticos em massa.', menuGroup: 'Proteção do número' }
  ],
  async execute({ sock, msg, args, invokedAs, senderNumber }) {
    const used = normalize(invokedAs)
    const action = used === 'pausarenvios' ? 'pausar'
      : used === 'retomarenvios' ? 'retomar'
        : used === 'limparfila' ? 'limpar'
          : normalize(args[0] || 'status')

    if (action === 'status') {
      const status = bulkSendQueueStatus()
      return reply(sock, msg, [
        `Estado: *${status.paused ? 'PAUSADA' : status.running ? 'ENVIANDO' : 'OCIOSA'}*`,
        `Pendentes: *${status.pending}*`,
        `Enviados no último minuto: *${status.sentLastMinute}/${status.limitPerMinute}*`,
        `Intervalo por grupo: *${Math.round(status.perChatDelayMs / 1000)}s*`,
        `Espera mais antiga: *${ageLabel(status.oldestQueuedAt)}*`,
        `Grupos controlados: *${status.trackedChats}*`,
        status.currentKey ? `Em execução: *${status.currentKey}*` : ''
      ].filter(Boolean).join('\n'), { title: 'FILA DE ENVIOS' })
    }

    if (action === 'pausar') {
      const status = setBulkSendQueuePaused(true)
      writeAudit({ actor: senderNumber, action: 'bulk-queue.pause', details: { pending: status.pending } })
      return reply(sock, msg, `Fila pausada. ${status.pending} tarefa(s) permanecerão aguardando.`)
    }

    if (action === 'retomar' || action === 'continuar') {
      const status = setBulkSendQueuePaused(false)
      writeAudit({ actor: senderNumber, action: 'bulk-queue.resume', details: { pending: status.pending } })
      return reply(sock, msg, `Fila retomada com ${status.pending} tarefa(s) pendente(s).`)
    }

    if (action === 'limpar' || action === 'cancelar') {
      const filter = String(args[1] || '').trim()
      const removed = filter ? cancelBulkSendJobs(filter) : clearBulkSendQueue('cancelamento pelo dono')
      writeAudit({ actor: senderNumber, action: 'bulk-queue.clear', target: filter, details: { removed } })
      return reply(sock, msg, `${removed} tarefa(s) pendente(s) cancelada(s).${filter ? ` Filtro: *${filter}*.` : ''}`)
    }

    return reply(sock, msg, [
      '*.filaenvios status*',
      '*.filaenvios pausar*',
      '*.filaenvios retomar*',
      '*.filaenvios limpar*',
      '*.filaenvios cancelar <grupo ou chave>*'
    ].join('\n'), { title: 'FILA DE ENVIOS' })
  }
})
