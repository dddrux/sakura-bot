import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const interactive = await fs.readFile(new URL('../interactive.js', import.meta.url), 'utf8')
const menu = await fs.readFile(new URL('../../commands/menu.js', import.meta.url), 'utf8')
assert.match(interactive, /function categorySections\(commands, requesterNumber/)
assert.match(interactive, /prefix\}perfil \$\{requester/)
assert.match(interactive, /sendSelectableCommandMenu\(\{ sock, msg, commands, logger, requesterNumber/)
assert.match(menu, /async execute\(\{[^}]*senderNumber/s)
assert.match(menu, /sendSelectableCommandMenu\(\{ sock, msg, commands, logger, requesterNumber: senderNumber \}\)/)
console.log('✅ Meu perfil aponta para quem abriu o catálogo')
