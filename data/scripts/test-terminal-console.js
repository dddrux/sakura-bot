import assert from 'node:assert/strict'
import { createConsoleCommands, parseConsoleLine, toJid } from '../terminal-console.js'
import { getConsoleLevel, setConsoleLevel } from '../logger.js'
import { formatConsoleTable } from '../terminal-theme.js'

const strip = v => String(v).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
process.env.NO_COLOR = '1'

assert.deepEqual(parseConsoleLine('  .Status '), { name: 'status', args: [], rest: '' })
assert.equal(parseConsoleLine('   '), null)
assert.equal(toJid('5581999990000'), '5581999990000@s.whatsapp.net')
assert.equal(toJid('2', [{ id: 'a@g.us' }, { id: 'b@g.us' }]), 'b@g.us')
assert.equal(toJid('abc'), null)
assert.match(formatConsoleTable('T', [['a', 1], ['bbb', 2]]), /T\n  a    1\n  bbb  2/)

const sent = []
let runtime = { autoReplyAudio: true, autoReplySticker: true }
let calls = { backup: 0, reconnect: 0, shutdown: [] }
const sock = {
  user: { id: '5581@s.whatsapp.net' },
  groupFetchAllParticipating: async () => ({ x: { id: 'x@g.us', subject: 'Zeta', participants: [1, 2] }, y: { id: 'y@g.us', subject: 'Alfa', participants: [1] } }),
  sendMessage: async (jid, content) => sent.push([jid, content])
}
let connected = true
const run = createConsoleCommands({
  getSocket: () => connected ? sock : null,
  getStatus: () => ({ connected, number: '5581', release: 'test' }),
  getRuntime: () => runtime,
  setRuntime: async v => { runtime = { ...runtime, ...v } },
  backup: async () => { calls.backup++ },
  reconnect: async () => { calls.reconnect++ },
  shutdown: async s => { calls.shutdown.push(s) },
  defaultLogLevel: 'warn'
})

assert.match(strip(await run('ajuda')), /Configurar[\s\S]*Controlar[\s\S]*enviar[\s\S]*Sistema[\s\S]*sair/)
assert.match(strip(await run('status')), /conexão\s+online/)
assert.match(strip(await run('grupos')), /1\s+Alfa \(1\)\n\s+2\s+Zeta \(2\)/)
assert.match(strip(await run('enviar 2 olá grupo')), /enviado para x/)
assert.deepEqual(sent[0], ['x@g.us', { text: 'olá grupo' }])
await run('enviar 5581999990000 oi')
assert.deepEqual(sent[1], ['5581999990000@s.whatsapp.net', { text: 'oi' }])
assert.match(strip(await run('enviar 123')), /uso:/)
assert.match(strip(await run('log debug')), /debug/)
assert.equal(getConsoleLevel('warn'), 'debug')
await run('log padrao'); assert.equal(getConsoleLevel('warn'), 'warn')
assert.match(strip(await run('log banana')), /inválido/)
await run('auto audio off'); assert.equal(runtime.autoReplyAudio, false)
await run('auto fig off'); assert.equal(runtime.autoReplySticker, false)
await run('backup'); await run('reconectar'); await run('sair')
assert.deepEqual([calls.backup, calls.reconnect, calls.shutdown], [1, 1, ['terminal']])
assert.match(strip(await run('xpto')), /não existe/)
connected = false
assert.match(strip(await run('enviar 5581999990000 oi')), /ainda não está conectada/)
assert.equal(await run('limpar'), '\x1bc')
setConsoleLevel(null)
console.log('✅ Console do terminal: comandos, destinos e erros aprovados')
