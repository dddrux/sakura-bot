import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const pkg = JSON.parse(read('package.json'))
const status = read('commands/group-status.js')
const relationships = read('commands/relationships.js')
const interactive = read('data/interactive.js')

assert.equal(pkg.version, '1.2.3')
assert.match(status, /sendZenkGroupStatus/)
assert.match(status, /groupStatusMessageV2/)
assert.match(status, /normalizeStatusVideo/)
assert.match(status, /postarstatusgrupo/)
assert.match(interactive, /function commandNeedsModel/)
assert.match(interactive, /menuModelOnly === true/)
assert.match(interactive, /menu command \$\{encodeToken\(command\.name\)\}/)
assert.match(relationships, /sendSocialTargetModel/)
assert.match(relationships, /Copiar modelo/)
assert.match(relationships, /O menu foi enviado pela Sakura/)

console.log('✅ v1.2.3: status baileys-mod e modelos de comandos interativos validados')
