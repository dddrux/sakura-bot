import os from 'node:os'
import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendManagerSnapshot } from '../data/send-manager.js'
import { mediaQueueSnapshot } from '../data/media-priority.js'
import { aiEngineStatus } from '../data/ai-engine.js'
import { settings } from '../data/settings.js'

const mb = bytes => `${Math.round(Number(bytes || 0) / 1024 / 1024)} MB`
const seconds = value => `${Math.floor(Number(value || 0))}s`

export default defineCommand({
  name: 'diagnostico',
  aliases: ['diag', 'statusbot', 'saude'],
  category: 'Configuração',
  usage: '.diagnostico',
  description: 'Mostra saúde, filas e runtime da Sakura.',
  ownerOnly: true,
  subownerAllowed: true,
  async execute({ sock, msg }) {
    const memory = process.memoryUsage()
    const send = sendManagerSnapshot()
    const media = mediaQueueSnapshot()
    const ai = aiEngineStatus()
    const sessionFiles = await import('node:fs/promises').then(fs => fs.readdir(settings.sessionDir).catch(() => [])).then(rows => rows.filter(name => name !== '.gitkeep' && name !== '.process.lock').length)
    return reply(sock, msg, [
      `versão: ${settings.release}`,
      `codinome: ${settings.codename}`,
      `node: ${process.version}`,
      `plataforma: ${process.platform} ${process.arch}`,
      `uptime: ${seconds(process.uptime())}`,
      `memória rss: ${mb(memory.rss)}`,
      `heap: ${mb(memory.heapUsed)} / ${mb(memory.heapTotal)}`,
      `cpu: ${os.cpus()?.[0]?.model || 'indisponível'}`,
      `sessão: /auth • ${sessionFiles} arquivo(s)`,
      `envios: ${send.sent} enviados • ${send.failed} falha(s) • ${send.averageMs}ms média`,
      `fila mensagens: ${send.queue?.pending || 0} pendente(s) • ${send.queue?.running || 0} ativa(s)`,
      `fila mídia: ${media.pending || 0} pendente(s) • ${media.running || 0} ativa(s)`,
      `IA: ${ai.configTokens || 0} token(s) • ${ai.inflightChats || 0} conversa(s) ativa(s)`,
      `banco: JSON central`,
      `menu: ${settings.menuMediaPath || settings.menuLogoPath}`
    ].join('\n'), { title: 'DIAGNÓSTICO' })
  }
})
