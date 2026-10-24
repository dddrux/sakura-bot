import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addSakuraStickerMetadata, buildSakuraStickerDescription, readSakuraStickerMetadata } from '../sticker-metadata.js'
import { shouldProcessOwnMessage } from '../superuser.js'
import { validatePublicMediaUrl, extractHttpUrls } from '../auto-download.js'
import { releaseVersionFromText } from '../release-announcer.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const json = rel => JSON.parse(read(rel))

function fakeWebp() {
  const vp8 = Buffer.alloc(10)
  const chunk = Buffer.alloc(18)
  chunk.write('VP8 ', 0); chunk.writeUInt32LE(vp8.length, 4); vp8.copy(chunk, 8)
  const out = Buffer.alloc(12 + chunk.length)
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WEBP', 8); chunk.copy(out, 12)
  return out
}

const description = buildSakuraStickerDescription({ userName: 'Drux', groupName: 'Grupo Sakura' })
const sticker = addSakuraStickerMetadata(fakeWebp(), { userName: 'Drux', description })
const exif = readSakuraStickerMetadata(sticker)
assert.equal(exif.description, description)
assert.equal(exif['sticker-pack-name'], '❄️ Enviado por: Drux')
assert.equal(exif['sticker-pack-publisher'], '💎 Feita pela: Sakurajima-Bot\n🧊 Grupo: Grupo Sakura')
assert.doesNotMatch(JSON.stringify(exif), /drux domina/i)

assert.equal(shouldProcessOwnMessage({ fromMe: true, text: 'Sakura, como usa .play?', prefix: '.' }), true, 'própria Sakura precisa acordar IA')
assert.equal(shouldProcessOwnMessage({ fromMe: true, text: 'mensagem comum sem chamar o bot', prefix: '.' }), false)
assert.equal(shouldProcessOwnMessage({ fromMe: true, text: '.menu', prefix: '.' }), true)

assert.deepEqual(extractHttpUrls('oi https://youtu.be/abc e https://example.com/video.mp4'), ['https://youtu.be/abc', 'https://example.com/video.mp4'])
assert.equal(validatePublicMediaUrl('https://example.com/video.mp4').ok, true)
for (const blocked of ['http://127.0.0.1/x', 'http://localhost/x', 'http://10.0.0.1/a', 'http://192.168.1.5/a', 'file:///etc/passwd']) {
  assert.equal(validatePublicMediaUrl(blocked).ok, false, `URL privada precisa ser bloqueada: ${blocked}`)
}

assert.equal(releaseVersionFromText('🌸 Sakura-MD 2.0.0-rc.9\nNotas de atualização'), '2.0.0-rc.9')
assert.equal(releaseVersionFromText('sem versão aqui'), '')

const pkg = json('package.json')
const cfg = json('config/sakura.config.json')
assert.match(pkg.version, /^2\.0\.0-rc\.(?:9|10|11)$/)
assert.match(cfg.bot.release, /^2\.0\.0-rc\.(?:9|10|11)$/)
assert.match(cfg.release, /^2\.0\.0-rc\.(?:9|10|11)$/)
assert.ok(cfg.releaseAnnouncements?.enabled, 'anúncio de release precisa ser configurável')
assert.ok('lastAnnouncedVersion' in cfg.releaseAnnouncements, 'estado de deduplicação precisa existir')
assert.ok(cfg.autoDownload && typeof cfg.autoDownload.enabledByDefault === 'boolean', 'AutoDownload precisa existir no config')

const handler = read('data/handler.js')
assert.match(handler, /maybeQueueAutoDownload/, 'handler precisa despachar AutoDownload genérico')
assert.match(handler, /senderIsSelf/, 'handler precisa preservar superusuário')

const automations = read('commands/automations.js')
assert.match(automations, /autodownload/i)
assert.match(automations, /Ativar/)
assert.match(automations, /Desativar/)

const tokens = read('commands/ai-tokens.js')
assert.match(tokens, /officialLinks:\s*false/, '.iatoken não pode anexar botões oficiais')
assert.match(tokens, /\.iatoken add TOKEN/i, 'ajuda precisa explicar sintaxe simples')
assert.match(tokens, /token atribuido!/)
assert.match(tokens, /deleteSensitiveMessage/)

const aiConfig = read('commands/ai-config.js')
assert.match(aiConfig, /Modelos/)
assert.match(aiConfig, /modelos?/i)
assert.match(aiConfig, /writeConfigSync/)

const owners = read('commands/owners.js')
assert.match(owners, /dono add/i)
assert.match(owners, /subdono add/i)
assert.match(owners, /isConnectedSelf|senderIsSelf|connectedSelf/i)

const groupAuto = read('data/group-automations.js')
assert.match(groupAuto, /welcomeBatches/)
assert.match(groupAuto, /Sejam bem-vindos/)

const info = read('commands/info.js')
assert.match(info, /title:\s*['"]Info['"]/)

const client = read('data/client.js')
assert.match(client, /announceReleaseIfNeeded/)

const media = cfg.ui?.menuMedia
assert.ok(media && fs.existsSync(path.join(root, media)), 'vídeo do menu precisa existir')
assert.ok(cfg.ui?.menuThumbnail && fs.existsSync(path.join(root, cfg.ui.menuThumbnail)), 'thumbnail do menu precisa existir')

console.log('✅ RC9: toggles, releases, IA, owners, boas-vindas, vídeo e AutoDownload')
