import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = file => fs.readFile(path.join(root, file), 'utf8')

const handler = await read('data/handler.js')
assert.match(handler, /normalizeCommandDefinition/)
assert.match(handler, /reactToCommand/)
assert.match(handler, /workstationContext/)
assert.match(handler, /isConfiguredOwner/)
assert.match(handler, /isVip/)
assert.match(handler, /command\.vipOnly/)
assert.match(handler, /showReceivedMessages/)

const bratCommand = await read('commands/brat.js')
assert.match(bratCommand, /alignment|alinhamento/)
assert.match(bratCommand, /nativeFlow/)
assert.match(bratCommand, /copy:/)
assert.match(bratCommand, /esquerda/)
assert.match(bratCommand, /direita/)

const mediaSource = await read('data/media.js')
assert.match(mediaSource, /resolveBratAlignment/)
assert.match(mediaSource, /alignment/)
assert.match(mediaSource, /Math\.min\(width - marginX - lineWidth/)

const economyUi = await read('data/economy-ui.js')
assert.match(economyUi, /currencyEmoji/)
assert.doesNotMatch(economyUi, /₱/)
assert.doesNotMatch(economyUi, /\*jid:\*/i)
assert.match(economyUi, /\*sistema:\*/i)

const economyCommand = await read('commands/economy.js')
assert.match(economyCommand, /getDevice/)
assert.match(economyCommand, /device[, :]/)

const terminalTheme = await read('data/terminal-theme.js')
assert.match(terminalTheme, /formatSakuraMessageLine/)
assert.match(terminalTheme, /SCOPE_SHORT/)
assert.match(terminalTheme, /magenta|purple|pink/i)
assert.doesNotMatch(terminalTheme, /SAKURA_ASCII|buildSakuraBannerLines|printSakuraBanner/)

console.log('V2 runtime tests: OK')
