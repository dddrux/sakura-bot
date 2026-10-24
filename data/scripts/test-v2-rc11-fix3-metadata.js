import assert from 'node:assert/strict'
import fs from 'node:fs'
import { addExactStickerMetadata, stripStickerMetadata } from '../sticker-metadata.js'

function vp8xFlags(buffer) {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const fourCC = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (fourCC === 'VP8X') return buffer[offset + 8]
    offset += 8 + size + (size % 2)
  }
  return null
}

const original = fs.readFileSync(new URL('../../assets/stickers/legacy/ban.webp', import.meta.url))
const tagged = addExactStickerMetadata(original, { packName: 'teste', publisher: 'teste' })
assert.ok((vp8xFlags(tagged) & 0x08) !== 0, 'fixture precisa carregar flag EXIF')
const stripped = stripStickerMetadata(tagged)
assert.equal(stripped.includes(Buffer.from('EXIF')), false, 'EXIF precisa ser removido')
assert.equal((vp8xFlags(stripped) || 0) & 0x08, 0, 'flag EXIF do VP8X precisa ser limpa quando o chunk EXIF é removido')
console.log('✅ RC11 fix3 metadata: WebP normalizado sem flag EXIF órfã')
