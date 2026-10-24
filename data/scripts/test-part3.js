import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-part3-'))
process.env.SAKURA_DB_FILE = path.join(temp, 'sakura-db.json')
process.env.BULK_SEND_MIN_DELAY_MS = '1'
process.env.BULK_SEND_MAX_DELAY_MS = '2'
process.env.BULK_SEND_PER_MINUTE = '60'

const { settings } = await import('../settings.js')
const store = await import('../ai-store.js')
const morning = await import('../global-morning-store.js')
const wake = await import('../ai-wake.js')
const bulk = await import('../bulk-send-queue.js')

settings.aiTokens = [
  { label: 'global', token: `gsk_${'a'.repeat(36)}`, enabled: true, scopeChat: '*' },
  { label: 'grupo', token: `gsk_${'b'.repeat(36)}`, enabled: true, scopeChat: '120363000000000@g.us' }
]
if (store.getAiPoolStatus().active !== 2) throw new Error('pool de tokens do config não foi reconhecido')
if (!wake.messageCallsSakura('Ei Sakura, consegue ajudar?')) throw new Error('Sakura no meio da frase não ativou')
if (!wake.messageCallsSakura('você sabe disso, sakura?')) throw new Error('Sakura no fim da frase não ativou')
if (wake.messageCallsSakura('sakurazinha não deve ativar')) throw new Error('palavra parcial ativou incorretamente')

const initial = morning.getGlobalMorningConfig()
if (initial.time !== '09:00' || initial.enabled) throw new Error('padrão seguro do bom dia global inválido')
const updated = morning.updateGlobalMorningConfig({ enabled: true, messages: ['Mensagem de teste válida.'] })
if (!updated.enabled || updated.messages.length !== 1) throw new Error('configuração global não persistiu')
morning.setGlobalMorningGroupDisabled('120363000000000@g.us', true)
if (!morning.isGlobalMorningDisabledForGroup('120363000000000@g.us')) throw new Error('exclusão por grupo falhou')
if (!morning.claimGlobalMorning('2026-07-24')) throw new Error('primeira marca diária falhou')
if (morning.claimGlobalMorning('2026-07-24')) throw new Error('duplicidade diária não foi bloqueada')

const order = []
await Promise.all([
  bulk.enqueueBulkSend(async () => order.push(1), { key: 'a' }),
  bulk.enqueueBulkSend(async () => order.push(2), { key: 'b' }),
  bulk.enqueueBulkSend(async () => order.push(3), { key: 'c' })
])
if (order.join(',') !== '1,2,3') throw new Error(`fila fora de ordem: ${order}`)

store.closeAiStore()
morning.closeGlobalMorningStore()
fs.rmSync(temp, { recursive: true, force: true })
console.log('✅ Parte 3: pool Groq em config, wake da IA, bom dia global e fila segura aprovados')
