import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
assert.match(pkg.version, /^2\./, 'a build da Parte 1 deve ser V2')
assert.equal(pkg.engines.node, '>=22.5.0')

const configFile = path.join(root, 'config', 'sakura.config.json')
const config = JSON.parse(await fs.readFile(configFile, 'utf8'))
assert.equal(config.bot.prefix, '.')
assert.equal(config.ui.updateChannel, 'https://whatsapp.com/channel/0029VbD1RJ39Bb5uJ7tk8a2Z')
assert.deepEqual(config.ui.emojis, ['💮', '🌸', '💮'])
assert.deepEqual(config.ui.contentEmojis, ['💮', '🌸'])
assert.equal(config.ui.dividerEmoji, '🪷')
assert.equal(config.economy.currencyName, 'Sakura Coins')
assert.equal(config.economy.currencyEmoji, '🪙')
assert.ok(Array.isArray(config.owners) && config.owners.length >= 1)

const settingsSource = await fs.readFile(path.join(root, 'data', 'settings.js'), 'utf8')
const databaseSource = await fs.readFile(path.join(root, 'data', 'database.js'), 'utf8')
assert.doesNotMatch(settingsSource, /node:sqlite|DatabaseSync/)
assert.doesNotMatch(databaseSource, /node:sqlite|DatabaseSync/)
assert.match(databaseSource, /rename\(/, 'store deve usar troca atômica de arquivo')

process.env.SAKURA_DB_FILE = path.join(root, 'storage', 'test-v2-foundation.json')
const { openDatabase, flushDatabase, closeAllDatabases } = await import('../database.js?test-v2=' + Date.now())
const store = openDatabase('foundation-test', { count: 0, nested: { ok: true } })
assert.equal((await store.read()).count, 0)
await store.update(db => { db.count += 1 })
await flushDatabase()
assert.equal((await store.read()).count, 1)
closeAllDatabases()
const saved = JSON.parse(await fs.readFile(process.env.SAKURA_DB_FILE, 'utf8'))
assert.equal(saved.namespaces['foundation-test'].count, 1)
await fs.rm(process.env.SAKURA_DB_FILE, { force: true })

const { defineCommand, normalizeCommandDefinition } = await import('../workstation.js')
const command = defineCommand({
  name: 'teste',
  category: 'Principal',
  reaction: '🌸',
  vipOnly: true,
  async run() { return 'ok' }
})
assert.equal(command.name, 'teste')
assert.equal(command.vipOnly, true)
assert.equal(typeof command.execute, 'function')
assert.equal(normalizeCommandDefinition({ name: 'legado', execute() {} }).reaction, '💮')

const { formatMessage } = await import('../formatter.js?test-v2=' + Date.now())
const formatted = formatMessage('Linha 1\n\nLinha 2', { title: 'Teste' })
assert.match(formatted, /🌸|🪷|💮/)
assert.doesNotMatch(formatted, /❄️|🧊|💎|🔹/)
assert.equal((formatted.match(/Linha 1/g) || []).length, 1)

const replySource = await fs.readFile(path.join(root, 'data', 'reply.js'), 'utf8')
const officialLinksSource = await fs.readFile(path.join(root, 'data', 'official-links.js'), 'utf8')
assert.doesNotMatch(replySource, /officialLinkActions|markCommandCta/, 'reply comum não deve injetar links oficiais')
assert.match(officialLinksSource, /updateChannel/)
assert.match(officialLinksSource, /url:/)
assert.match(await fs.readFile(path.join(root, 'commands', 'menu.js'), 'utf8'), /officialLinks:\s*true/, 'menu precisa habilitar links oficiais explicitamente')

const forkMessagesSource = await fs.readFile(path.join(root, 'data', 'vendor', 'sakura-baileys', 'lib', 'Utils', 'messages.js'), 'utf8')
assert.match(forkMessagesSource, /cta_url/)

const interactiveSource = await fs.readFile(path.join(root, 'data', 'interactive.js'), 'utf8')
assert.doesNotMatch(interactiveSource, /const body = \[\s*const body = \[/)

console.log('V2 foundation tests: OK')
