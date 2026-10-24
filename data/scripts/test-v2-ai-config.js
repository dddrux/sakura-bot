import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = await fs.readFile(path.join(root, 'data', 'ai-engine.js'), 'utf8')
assert.match(source, /settings\.aiTokens/)
assert.match(source, /configTokenPool/)
assert.match(source, /rawToken/)
assert.match(source, /settings\.aiEnabled/)
const config = JSON.parse(await fs.readFile(path.join(root, 'config', 'sakura.config.json'), 'utf8'))
assert.ok(Array.isArray(config.ai.tokens))
console.log('V2 AI config tests: OK')
