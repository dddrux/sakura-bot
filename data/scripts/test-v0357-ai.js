import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0357-ai-'))
process.env.SAKURA_DB_FILE = path.join(temp, 'sakura-db.json')
process.env.GROQ_BASE_URL = 'https://groq.test/openai/v1'

const { settings } = await import('../settings.js')
const store = await import('../ai-store.js')
const client = await import('../ai-client.js')
const engine = await import('../ai-engine.js')

const tokenA = `gsk_${'a'.repeat(36)}`
const tokenB = `gsk_${'b'.repeat(36)}`
settings.aiTokens = [
  { label: 'primeiro', token: tokenA, enabled: true, scopeChat: '*' },
  { label: 'segundo', token: tokenB, enabled: true, scopeChat: '*' }
]

let chatCalls = 0
client.setAiFetchImplementationForTests(async url => {
  if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'modelo-teste' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  chatCalls += 1
  if (chatCalls === 1) return new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } })
  return new Response(JSON.stringify({
    model: 'modelo-teste',
    choices: [{ message: { content: 'Oi! Eu sou a Sakura e a rotação funcionou.' } }],
    usage: { prompt_tokens: 30, completion_tokens: 12 }
  }), { status: 200, headers: { 'content-type': 'application/json' } })
})

store.updateAiGroupConfig('120363000000000@g.us', { enabled: true, mode: 'mention', cooldownMs: 3000, dailyLimit: 3 })
const sent = []
const sock = {
  user: { id: '558199999999:1@s.whatsapp.net' },
  async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: `out-${sent.length}` } } }
}
const msg = {
  key: { id: 'm1', remoteJid: '120363000000000@g.us', participant: '558188888888@s.whatsapp.net' },
  pushName: 'Pessoa',
  message: { extendedTextMessage: { text: 'Sakura, está funcionando?', contextInfo: { mentionedJid: ['558199999999@s.whatsapp.net'] } } }
}
const logs = []
const logger = { info(data, text) { logs.push({ level: 'info', data, text }) }, warn(data, text) { logs.push({ level: 'warn', data, text }) }, debug() {} }
const result = await engine.maybeHandleAi({ sock, msg, text: 'Sakura, está funcionando?', numbers: { sender: '558188888888', chat: '120363000000000' }, logger, isGroup: true, mentionedBot: true })
if (!result.handled || sent.length !== 1) throw new Error('IA não respondeu após rotação')
if (!JSON.stringify(sent[0].content).includes('rotação funcionou')) throw new Error('resposta da IA não foi enviada')
if (chatCalls !== 2) throw new Error(`rotação deveria usar 2 tentativas, usou ${chatCalls}`)
if (JSON.stringify(logs).includes(tokenA) || JSON.stringify(logs).includes(tokenB)) throw new Error('token apareceu nos logs')
if (store.getAiPoolStatus().active !== 2) throw new Error('pool do config não foi reconhecido')
store.closeAiStore()
fs.rmSync(temp, { recursive: true, force: true })
console.log('✅ Parte 7: pool em config, rotação 429 e logs protegidos aprovados')
