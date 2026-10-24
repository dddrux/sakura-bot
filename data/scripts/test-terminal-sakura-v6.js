import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSakuraMessageLine, formatSakuraTerminalLine } from '../terminal-theme.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stripAnsi = value => String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')

const line = stripAnsi(formatSakuraTerminalLine({
  time: '19:07:00',
  level: 'info',
  scope: 'CONNECTION',
  message: 'conectando aos servidores do WhatsApp'
}))
assert.equal(line, '19:07:00 │ CONN    conectando aos servidores do WhatsApp')
assert.equal(stripAnsi(formatSakuraTerminalLine({ time: '19:07:01', level: 'warn', scope: 'COMMANDS', message: 'x' })), '19:07:01 │ CMD   ! x')

const message = stripAnsi(formatSakuraMessageLine({
  time: '19:07:01',
  senderName: 'Mel',
  senderNumber: '5512996038129',
  isGroup: true,
  text: 'oi sakura'
}))
assert.equal(message, '19:07:01 │ MSG     Mel (+5512996038129) · grupo · oi sakura')

const clientSource = fs.readFileSync(path.join(root, 'data/client.js'), 'utf8')
assert.doesNotMatch(clientSource, /printSakuraBanner|SAKURA_ASCII|WORKSTATION/, 'o cabeçalho antigo voltou ao boot')

console.log('✅ Terminal Sakura V2: compacto, sem cabeçalho e sem campos técnicos no fluxo normal')
