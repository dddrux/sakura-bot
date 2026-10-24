import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addSakuraStickerMetadata } from '../sticker-metadata.js'
import { sendZenkGroupStatus } from '../zenk-group-status.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.version, '1.2.3')
assert.equal(pkg.dependencies['@whiskeysockets/baileys'], 'file:data/vendor/whiskeysockets-baileys-7.0.0-rc13-zenk.1.tgz')

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

const user = metadata(addSakuraStickerMetadata(fakeWebp(), { userName: 'Drux' }))
assert.equal(user['sticker-pack-name'], 'sakura-md ❅ Drux')
assert.equal(user['sticker-pack-publisher'], 'Sakura-MD')
assert.notEqual(user['sticker-pack-name'], user['sticker-pack-publisher'])
assert.equal('sticker-pack-description' in user, false)
const rewritten = addSakuraStickerMetadata(addSakuraStickerMetadata(fakeWebp(), { userName: 'Antigo' }), { userName: 'Novo' })
assert.equal((rewritten.toString('utf8').match(/\"sticker-pack-id\"/g) || []).length, 1, 'mais de um EXIF foi gravado')
const rewrittenMetadata = metadata(rewritten)
assert.equal(rewrittenMetadata['sticker-pack-name'], 'sakura-md ❅ Novo')
assert.equal(rewrittenMetadata['sticker-pack-publisher'], 'Sakura-MD')

const auto = metadata(addSakuraStickerMetadata(fakeWebp(), {
  packName: 'sakura-md ❅ drux domina',
  author: 'Sakura-MD',
  description: ''
}))
assert.equal(auto['sticker-pack-name'], 'sakura-md ❅ drux domina')
assert.equal(auto['sticker-pack-publisher'], 'Sakura-MD')
assert.notEqual(auto['sticker-pack-name'], auto['sticker-pack-publisher'])

const calls = []
const sock = {
  user: { id: '5511999999999:1@s.whatsapp.net' },
  logger: { child() { return this }, trace() {}, debug() {}, info() {}, warn() {}, error() {} },
  waUploadToServer: async () => ({ mediaUrl: '', directPath: '' }),
  async relayMessage(jid, message, options) { calls.push({ jid, message, options }) }
}
const result = await sendZenkGroupStatus(sock, '120363000000000000@g.us', { text: 'Teste Sakura' })
assert.equal(calls.length, 1)
assert.equal(calls[0].jid, '120363000000000000@g.us')
assert.ok(calls[0].message.groupStatusMessageV2)
const inner = calls[0].message.groupStatusMessageV2.message
assert.equal(inner.extendedTextMessage.text, 'Teste Sakura')
assert.equal(inner.extendedTextMessage.contextInfo.isGroupStatus, true)
assert.equal(result.transport, 'zenk/groupStatusMessageV2')
console.log('✅ v1.2.3: transporte ZENK de status e metadados sem duplicação aprovados')
