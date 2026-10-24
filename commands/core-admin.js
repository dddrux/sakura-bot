import { defineCommand } from '../data/workstation.js'
import fs from 'node:fs'
import { addSubowner, getCoreStatus, listAudit, listSubowners, removeSubowner } from '../data/core-store.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { groupNameMap, displayUser, formatMentionName } from '../data/user-display.js'
import { reply } from '../data/reply.js'
import { hasPermission, PERMISSIONS } from '../data/permissions.js'
import { getSocialStatus } from '../data/social-store.js'
import { getAiStoreStatus } from '../data/ai-store.js'
import { getAutomationStatus } from '../data/automation-store.js'
import { globalMorningStoreStatus } from '../data/global-morning-store.js'
import { bulkSendQueueStatus } from '../data/bulk-send-queue.js'
import { aiEngineStatus } from '../data/ai-engine.js'
import { privateProtectionStatus } from '../data/private-protection.js'
import { commandMediaStoreStatus } from '../data/fun-media-store.js'

const digits = value => String(value || '').replace(/\D/g, '')
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function targetNumber(msg, args = []) {
  const context = getContextInfo(msg?.message)
  const mentioned = firstTargetJid(msg, args)
  return digits(mentioned) || digits(args.find(item => /\d{8,}/.test(String(item || ''))))
}

function relativeDate(value) {
  if (!value) return 'data indisponível'
  return new Date(Number(value)).toLocaleString('pt-BR', { timeZone: 'America/Recife' })
}

export default defineCommand({
  name: 'coreadmin',
  aliases: ['auditoria', 'statusmodulos', 'statussistema'],
  menuEntries: [
    { name: 'statusmodulos', usage: '.statusmodulos', description: 'Mostra a integridade do núcleo e dos bancos.', menuGroup: 'Dono' },
    { name: 'auditoria', usage: '.auditoria', description: 'Mostra alterações administrativas recentes.', menuGroup: 'Dono' }
  ],
  category: 'Dono',
  usage: '.statusmodulos',
  ownerOnly: true,
  subownerAllowed: true,
  async execute({ sock, msg, args, text, settings, isOwner, isSubowner, role, senderNumber }) {
    const used = normalize(text.slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const effectiveRole = role || (isOwner ? 'owner' : isSubowner ? 'subowner' : 'member')
    const action = normalize(args[0])

    if (used === 'statusmodulos' || used === 'statussistema') {
      const status = getCoreStatus()
      const databaseCount = fs.readdirSync(settings.configDir).filter(name => name.endsWith('.db')).length
      const social = getSocialStatus()
      const ai = getAiStoreStatus()
      const automations = getAutomationStatus()
      const globalMorning = globalMorningStoreStatus()
      const bulkQueue = bulkSendQueueStatus()
      const aiRuntime = aiEngineStatus()
      const privateProtection = privateProtectionStatus()
      const commandMedia = commandMediaStoreStatus()
      const memory = process.memoryUsage()
      return reply(sock, msg, [
        `núcleo: v${status.release} • canal estável`,
        `migração: ${status.schemaVersion}/${status.expectedSchemaVersion}`,
        `integridade: ${status.integrity}`,
        `painel: autenticação limitada • segredo inicial fora do terminal`,
        `prévia de links: dependência corrigida`,
        `bancos detectados: ${databaseCount}`,
        `subdonos ativos: ${status.subowners}`,
        `nomes lembrados: ${status.users}`,
        `social: ${social.couples} casal(is) • ${social.familyLinks} vínculo(s) • ${social.pending} pedido(s)`,
        `mídias de ações: ${social.actionMedia}`,
        `mídias de comandos: ${commandMedia.enabledItems}/${commandMedia.items} ativa(s) • ${commandMedia.groupsWithAdminPermission} grupo(s) com permissão admin`,
        `IA: ${ai.global.globalEnabled ? 'global ligada' : 'global desligada'} • ${ai.groups} grupo(s) • ${ai.pool.ready}/${ai.pool.total} token(s) pronto(s)`,
        `tokens IA: ${ai.pool.ready}/${ai.pool.total} disponíveis no config`,
        `automações: ${automations.welcomes} boas-vindas • ${automations.tiktok} TikTok • ${automations.daily} rotina(s) • ${automations.blocked} bloqueado(s)`,
        `bom dia global: ${globalMorning.config.enabled ? 'ligado' : 'desligado'} • ${globalMorning.config.time} • ${globalMorning.excludedGroups} grupo(s) ignorado(s)`,
        `proteção privada: Anti-PV ${privateProtection.message.enabled ? 'ligado' : 'desligado'} • chamadas ${privateProtection.call.enabled ? 'ligado' : 'desligado'} • ${privateProtection.blocked} bloqueio(s)`,
        `fila de massa: ${bulkQueue.paused ? 'pausada' : 'ativa'} • ${bulkQueue.pending} pendente(s) • ${bulkQueue.sentLastMinute}/${bulkQueue.limitPerMinute} no último minuto`,
        `motor IA: ${aiRuntime.inflightChats} conversa(s) ativa(s) • ${aiRuntime.deferredRetries} nova(s) tentativa(s) agendada(s)`,
        `memória: ${Math.round(memory.rss / 1024 / 1024)} MB RSS • ${Math.round(memory.heapUsed / 1024 / 1024)} MB heap`, 
        'sessão e segredos: protegidos e não exibidos'
      ].join('\n'), { title: 'STATUS DO SISTEMA' })
    }

    if (used === 'auditoria') {
      if (!hasPermission(effectiveRole, PERMISSIONS.AUDIT)) return reply(sock, msg, 'Apenas o dono principal pode consultar a auditoria.')
      const limit = Math.max(1, Math.min(30, Number(args[0]) || 15))
      const rows = listAudit(limit)
      return reply(sock, msg, rows.length ? rows.map((row, index) => [
        `${index + 1}. ${row.action}`,
        `autor: ${row.actor ? `+${row.actor}` : 'sistema'}`,
        row.target ? `alvo: ${row.target}` : '',
        `data: ${relativeDate(row.createdAt)}`
      ].filter(Boolean).join(' • ')).join('\n') : 'Nenhuma alteração administrativa registrada.', { title: 'AUDITORIA' })
    }

    if (!['auditoria', 'statusmodulos', 'statussistema', 'coreadmin'].includes(used)) return reply(sock, msg, 'Use .statusmodulos ou .auditoria.')

    return reply(sock, msg, 'Use .statusmodulos ou .auditoria.', { title: 'ADMINISTRAÇÃO' })
  }
})
