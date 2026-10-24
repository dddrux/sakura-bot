import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

assert.match(source, /function\s+maskNumber\s*\(/, 'client.js precisa definir maskNumber antes de usá-la')
assert.doesNotMatch(
  source,
  /if\s*\(msg\?\.key\?\.fromMe\)\s*\{[\s\S]{0,180}?return/,
  'client.js não pode descartar cegamente todas as mensagens fromMe antes do handler'
)
assert.match(source, /shouldProcessOwnMessage/, 'client.js deve encaminhar comandos próprios e filtrar apenas ecos normais')

console.log('✅ RC3 client regression: maskNumber + own commands')
