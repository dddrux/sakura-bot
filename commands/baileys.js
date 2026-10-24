import { defineCommand } from '../data/workstation.js'
import { SAKURA_FORK_INFO } from '@sakura-md/baileys'
import { reply } from '../data/reply.js'

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function line(label, value) {
  return `▢ • *${label}:* ${value}`
}

export default defineCommand({
  name: 'baileys',
  aliases: ['socketdebug', 'forkstatus', 'baileysdebug'],
  category: 'Dono',
  description: 'Mostra métricas do socket, caches, relay, envios, LID e metadados.',
  usage: '.baileys [cache|limpargp]',
  ownerOnly: true,
  async execute({ sock, msg, args }) {
    const action = String(args?.[0] || '').toLowerCase()

    if (action === 'cache') {
      const removed = sock.sakuraPruneCaches?.() || {}
      return reply(sock, msg, [
        line('Mensagens removidas', number(removed.removedMessages)),
        line('Grupos removidos', number(removed.removedGroups)),
        line('LIDs removidos', number(removed.removedLids))
      ].join('\n'), { title: 'CACHE DO BAILEYS', icon: '💮' })
    }

    if (action === 'limpargp' || action === 'refreshgp') {
      const chat = msg.key.remoteJid
      const removed = chat?.endsWith('@g.us') ? sock.sakuraInvalidateGroupMetadata?.(chat, 'owner-command') : false
      return reply(sock, msg, removed
        ? 'Cache deste grupo invalidado. A próxima ação buscará participantes atualizados.'
        : 'Não havia cache deste grupo para remover.', { title: 'CACHE DO GRUPO', icon: '💮' })
    }

    const data = sock.sakuraSnapshotDiagnostics?.() || {}
    const body = [
      line('Fork', `${SAKURA_FORK_INFO.name} ${SAKURA_FORK_INFO.version}`),
      line('WebSocket', data.wsOpen ? 'aberto' : 'fechado'),
      line('Recebidas', number(data.incomingMessages)),
      line('Envios', `${number(data.sendSuccess)}/${number(data.sendCalls)}`),
      line('Erros de envio', number(data.sendErrors)),
      line('Relays', `${number(data.relaySuccess)}/${number(data.relayCalls)}`),
      line('Cache de mensagens', number(data.recentMessages)),
      line('Cache hit/miss', `${number(data.messageCacheHits)}/${number(data.messageCacheMisses)}`),
      line('Metadados de grupos', number(data.groupMetadataCache)),
      line('Grupo hit/miss', `${number(data.groupMetadataHits)}/${number(data.groupMetadataMisses)}`),
      line('Fallbacks antigos', number(data.groupMetadataStaleHits)),
      line('Cache LID', number(data.lidCache)),
      line('LID hit/miss', `${number(data.lidCacheHits)}/${number(data.lidCacheMisses)}`),
      '',
      'Use *.baileys cache* para limpar entradas vencidas.',
      'Use *.baileys limpargp* dentro de um grupo para forçar atualização.'
    ].join('\n')
    return reply(sock, msg, body, { title: 'DIAGNÓSTICO BAILEYS', icon: '💮' })
  }
})
