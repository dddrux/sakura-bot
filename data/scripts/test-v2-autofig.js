import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = file => fs.readFile(path.join(root, file), 'utf8')
const runtime = await read('data/runtime.js')
const library = await read('data/sticker-library.js')
const handler = await read('data/handler.js')
const automaticos = await read('commands/automaticos.js')
assert.match(runtime, /autoStickerRandom/)
assert.match(runtime, /autoStickerLibraryChance/)
assert.match(library, /excludeHashes/)
assert.match(library, /options\.chat|chat.*options/)
assert.match(handler, /autoStickerRandom/)
assert.match(handler, /getRandomSticker/)
assert.match(automaticos, /autofig/)
assert.match(automaticos, /aleator/i)
console.log('V2 autofig tests: OK')
