import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSakuraStickerDescription, addSakuraStickerMetadata } from '../sticker-metadata.js'
import { wrapSakuraLine } from '../formatter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

function fakeWebp() {
  const vp8 = Buffer.alloc(10)
  const chunk = Buffer.alloc(18)
  chunk.write('VP8 ', 0); chunk.writeUInt32LE(vp8.length, 4); vp8.copy(chunk, 8)
  const out = Buffer.alloc(12 + chunk.length)
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WEBP', 8); chunk.copy(out, 12)
  return out
}
function metadata(buffer) {
  const text = buffer.toString('utf8')
  const start = text.indexOf('{"sticker-pack-id"')
  assert.ok(start >= 0, 'EXIF JSON ausente')
  return JSON.parse(text.slice(start, text.indexOf('}', start) + 1))
}

const expected = [
  '❄️ Enviado por: Drux',
  '💎 Feita pela: Sakurajima-Bot',
  '🧊 Grupo: Grupo Sakura'
].join('\n')
assert.equal(buildSakuraStickerDescription({ userName: 'Drux', groupName: 'Grupo Sakura' }), expected)
const exif = metadata(addSakuraStickerMetadata(fakeWebp(), { userName: 'Drux', description: expected }))
assert.equal(exif['sticker-pack-description'], expected)
assert.equal(exif.packDescription, expected)
assert.equal(exif.description, expected)
assert.doesNotMatch(JSON.stringify(exif), /drux domina/i)

assert.deepEqual(wrapSakuraLine('um dois tres quatro', 4), ['um dois tres quatro'])
assert.deepEqual(wrapSakuraLine('FRASE EXTREMAMENTE GIGANTE DESCONFIGURADA', 4), ['FRASE EXTREMAMENTE GIGANTE DESCONFIGURADA'])

const interactive = read('data/interactive.js')
assert.match(interactive, /catalogCategoryTitle|\*IA\*/i, 'catálogo precisa mapear Inteligência artificial para IA')
assert.doesNotMatch(interactive, /lines\.push\(settings\.footer\)/, 'catálogo não pode repetir footer no corpo')

for (const rel of ['commands/s.js','commands/s20.js','commands/figvip.js','commands/brat.js','commands/figsorteio.js']) {
  assert.match(read(rel), /buildSakuraStickerDescription/, `${rel} precisa usar o metadata Sakura central`)
}
assert.match(read('data/handler.js'), /buildSakuraStickerDescription/, 'AutoFig precisa aplicar metadata dinâmico')
assert.match(read('commands/take.js'), /vipOnly:\s*true/)
assert.match(read('commands/take.js'), /stripStickerMetadata/)
assert.match(read('commands/take.js'), /addExactStickerMetadata/)

console.log('✅ RC8: metadata de figurinhas, formatador adaptativo e catálogo limpo')
