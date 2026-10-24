import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(new URL('../../commands/fun.js', import.meta.url), 'utf8')
const menuSource = await fs.readFile(new URL('../interactive.js', import.meta.url), 'utf8')
assert.match(source, /formatMessage/)
assert.match(source, /legacyCaption\('SAKURA SHIP'/)
assert.match(source, /legacyCaption\('CASAL DA SAKURA'/)
assert.match(source, /legacyCaption\('BRINCADEIRA DA SAKURA'/)
assert.doesNotMatch(source, /caption:\s*`❤️ \*Sakura Ship\*/)
assert.match(menuSource, /╭━━⪩ 🧊 \*MENU PRINCIPAL\* ⪨━━/)
assert.match(menuSource, /Escolha um comando no catálogo:/)
assert.doesNotMatch(menuSource, /Oi! Eu sou a \${settings\.baseName}/)

console.log('✅ Brincadeiras: ship, casal e porcentagens usam o visual clássico do menu')
