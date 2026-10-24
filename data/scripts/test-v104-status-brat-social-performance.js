import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v104-'))
process.env.SAKURA_DB_FILE = path.join(temp, 'sakura-db.json')

const { socialPlatform, isSocialMediaUrl } = await import('../social-downloader.js')
const { getAutomationConfig, updateAutomationConfig, reserveSocialUrl, getAutomationStatus, closeAutomationStore } = await import('../automation-store.js')
const { addSakuraStickerMetadata } = await import('../sticker-metadata.js')
const { sendGroupStatusBroadcast } = await import('../../commands/group-status.js')

assert.equal(socialPlatform('https://www.instagram.com/reel/ABC123/'), 'Instagram')
assert.equal(socialPlatform('https://pin.it/abc123'), 'Pinterest')
assert.equal(socialPlatform('https://br.pinterest.com/pin/123/'), 'Pinterest')
assert.equal(isSocialMediaUrl('https://example.com/video'), false)

const chat = '120363000000000000@g.us'
const initial = getAutomationConfig(chat)
assert.equal(initial.socialAutoEnabled, false)
const enabled = updateAutomationConfig(chat, { socialAutoEnabled: true })
assert.equal(enabled.socialAutoEnabled, true)
assert.equal(getAutomationConfig(chat).socialAutoEnabled, true)
assert.equal(reserveSocialUrl(chat, 'Instagram', 'https://instagram.com/reel/test'), true)
assert.equal(reserveSocialUrl(chat, 'Instagram', 'https://instagram.com/reel/test'), false)
assert.equal(getAutomationStatus().schemaVersion, 2)

const automationStatus = getAutomationStatus()
assert.equal(automationStatus.schemaVersion, 2)

const calls = []
const fakeSock = {
  sendMessage: async (jid, content, options) => {
    calls.push({ jid, content, options })
    return { key: { id: 'STATUS-V104', remoteJid: jid }, message: { groupStatusMessageV2: { message: { videoMessage: { contextInfo: { isGroupStatus: true } } } } } }
  }
}
const video = Buffer.from('fake-video-for-contract-test')
const result = await sendGroupStatusBroadcast(fakeSock, chat, {
  video,
  mimetype: 'video/mp4',
  seconds: 7,
  caption: 'Teste de vídeo'
}, ['5511999999999@s.whatsapp.net'])
const sent = result.sent
assert.equal(sent.key.id, 'STATUS-V104')
assert.equal(calls.length, 1)
assert.equal(calls[0].jid, chat)
assert.equal(calls[0].content.groupStatus, true)
assert.equal(calls[0].content.mimetype, 'video/mp4')
assert.deepEqual(calls[0].content.video, video)

const sampleSticker = await fs.readFile(path.join(root, 'assets', 'stickers', 'legacy', 'ban.webp'))
const sticker = addSakuraStickerMetadata(sampleSticker, { botName: 'Sakura-MD', userName: 'Usuario' })
assert.equal(sticker.toString('ascii', 0, 4), 'RIFF')
assert.match(sticker.toString('utf8'), /sakura-md ❅ Usuario/)
assert.equal((sticker.toString('utf8').match(/sakura-md ❅ Usuario/g) || []).length >= 2, true)

const statusSource = await fs.readFile(path.join(root, 'commands', 'group-status.js'), 'utf8')
const bratSource = await fs.readFile(path.join(root, 'data', 'media.js'), 'utf8')
const handlerSource = await fs.readFile(path.join(root, 'data', 'handler.js'), 'utf8')
const loggerSource = await fs.readFile(path.join(root, 'data', 'logger.js'), 'utf8')
const automationSource = await fs.readFile(path.join(root, 'data', 'automation-store.js'), 'utf8')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

assert.equal(packageJson.version, '1.2.3')
assert.match(statusSource, /sendZenkGroupStatus/)
assert.match(statusSource, /groupStatusMessageV2/)
assert.match(bratSource, /DejaVu Sans/)
assert.match(bratSource, /const lineHeight = 1\.08/)
assert.match(bratSource, /if \(sharp\)/)
assert.match(handlerSource, /messageLogger\.debug\.bind\(messageLogger\)/)
assert.match(loggerSource, /LOW_POWER_ARM \? 900 : 250/)
assert.match(automationSource, /CONFIG_CACHE_TTL_MS = 60_000/)

closeAutomationStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ compatibilidade v1.0.4: status groupStatusMessageV2, Brat ARM, downloader direto e cache validados')
