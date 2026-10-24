import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { addExactStickerMetadata, readSakuraStickerMetadata, stripStickerMetadata } from '../sticker-metadata.js'

const source = await fs.readFile(new URL('../../assets/stickers/legacy/bomdia.webp', import.meta.url))
const clean = stripStickerMetadata(source)
assert.equal(readSakuraStickerMetadata(clean), null, 'stripStickerMetadata deve remover EXIF')
const tagged = addExactStickerMetadata(clean, { packName: 'figurinha tal', publisher: '' })
const metadata = readSakuraStickerMetadata(tagged)
assert.equal(metadata?.['sticker-pack-name'], 'figurinha tal')
assert.equal(metadata?.['sticker-pack-publisher'], '')
assert.equal((tagged.toString('utf8').match(/figurinha tal/g) || []).length, 1, 'nome personalizado não deve ser duplicado')

const triggerSource = await fs.readFile(new URL('../triggers.js', import.meta.url), 'utf8')
assert.match(triggerSource, /packName:\s*['\"]drux domina['\"]/)
assert.match(triggerSource, /publisher:\s*['\"]['\"]/)

const takeSource = await fs.readFile(new URL('../../commands/take.js', import.meta.url), 'utf8')
assert.match(takeSource, /vipOnly:\s*true/, '.take deve ser VIP-only')
assert.match(takeSource, /if \(!vipAccess\).*take.*VIP/is, '.take deve manter defesa em profundidade')
assert.match(takeSource, /stripStickerMetadata\(raw\)/, '.take deve limpar metadata existente')
assert.match(takeSource, /addExactStickerMetadata\(cleanSticker/, '.take custom deve usar metadata exata')
console.log('✅ stickers automáticos + .take limpo e VIP')
