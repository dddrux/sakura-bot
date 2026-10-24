import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeCommandDefinition } from '../workstation.js'
import { addSakuraStickerMetadata, buildSakuraStickerDescription, readSakuraStickerMetadata } from '../sticker-metadata.js'

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

// CTAs oficiais são opt-in: comandos comuns/admin/dono nunca recebem links por padrão.
const ordinary = normalizeCommandDefinition({ name: 'teste-ui', category: 'Administração', execute() {} })
assert.equal(ordinary.officialLinks, false, 'officialLinks deve ser opt-in para impedir botões em respostas comuns')
assert.match(read('commands/menu.js'), /officialLinks:\s*true/, 'menu precisa optar explicitamente pelos links oficiais')
assert.doesNotMatch(read('data/reply.js'), /officialLinkActions|markCommandCta/, 'reply comum não pode injetar CTA oficial implicitamente')
assert.doesNotMatch(read('data/handler.js'), /sendOfficialLinksBar/, 'handler não pode anexar barra oficial após qualquer comando')
assert.match(read('data/interactive.js'), /includeUpdateCta\s*=\s*false/, 'UI interativa deve partir sem CTA externo e só habilitar em superfície segura')

// Metadados visíveis de TODAS as figurinhas usam o padrão Sakura central, sem flores/lotus antigas.
const expectedDescription = [
  '❄️ Enviado por: Drux',
  '💎 Feita pela: Sakurajima-Bot',
  '🧊 Grupo: Grupo Sakura'
].join('\n')
assert.equal(buildSakuraStickerDescription({ userName: 'Drux', groupName: 'Grupo Sakura' }), expectedDescription)
const sticker = addSakuraStickerMetadata(fakeWebp(), { userName: 'Drux', description: expectedDescription })
const exif = readSakuraStickerMetadata(sticker)
assert.equal(exif.description, expectedDescription)
assert.equal(exif['sticker-pack-name'], '❄️ Enviado por: Drux')
assert.equal(exif['sticker-pack-publisher'], '💎 Feita pela: Sakurajima-Bot\n🧊 Grupo: Grupo Sakura')
assert.doesNotMatch(JSON.stringify(exif), /🌸|💮|🪷|SAKURA-BOT|requisitado por|no grupo/i)

console.log('✅ hardening UI/stickers: CTAs somente opt-in e metadata Sakura padronizado')
