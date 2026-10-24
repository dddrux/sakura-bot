import assert from 'node:assert/strict'
import fs from 'node:fs'
import { addExactStickerMetadata } from '../sticker-metadata.js'
import * as converter from '../sticker-convert.js'

assert.equal(typeof converter.stickerDecodeCandidates, 'function', 'conversor precisa tentar mídia original e normalizada')
const original = fs.readFileSync(new URL('../../assets/stickers/legacy/ban.webp', import.meta.url))
const tagged = addExactStickerMetadata(original, { packName: 'teste', publisher: 'teste' })
const candidates = converter.stickerDecodeCandidates(tagged)
assert.ok(candidates.length >= 2, 'WebP com EXIF precisa produzir original + versão normalizada')
assert.ok(candidates[0].buffer.equals(tagged), 'primeira tentativa deve preservar os bytes originais recebidos do WhatsApp')
assert.equal(candidates[0].kind, 'original')
assert.equal(candidates[1].kind, 'normalized')
assert.equal(candidates[1].buffer.includes(Buffer.from('EXIF')), false, 'versão normalizada deve remover EXIF')
console.log('✅ RC11 fix3 converter: original + WebP normalizado serão tentados')
