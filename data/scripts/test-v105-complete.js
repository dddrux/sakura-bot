import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v105-'))
process.env.SAKURA_CONFIG_DB = path.join(temp, 'bot.db')
process.env.SAKURA_PROTECTION_DB = path.join(temp, 'protection.db')
process.env.SAKURA_VIP_DB = path.join(temp, 'vip.db')
process.env.SAKURA_CORE_DB = path.join(temp, 'core.db')
process.env.SAKURA_RENTAL_DB = path.join(temp, 'rentals.db')
process.env.SAKURA_ECONOMY_DB = path.join(temp, 'economy.db')

const { getProtectionConfig, updateProtectionConfig, closeProtectionStore } = await import('../protection-store.js')
const { containsBlockedLink } = await import('../anti-link.js')
const { addSakuraStickerMetadata } = await import('../sticker-metadata.js')
const { installMentionResolver } = await import('../mentions.js')

const chat = '120363111111111111@g.us'
assert.equal(getProtectionConfig(chat).antilinkEnabled, false)
assert.equal(updateProtectionConfig(chat, { antilinkEnabled: true }).antilinkEnabled, true)
assert.equal(getProtectionConfig(chat).antilinkEnabled, true)
assert.equal(containsBlockedLink('acesse https://example.com agora'), true)
assert.equal(containsBlockedLink('mensagem sem endereço'), false)

const sampleSticker = await fs.readFile(path.join(root, 'assets', 'stickers', 'legacy', 'ban.webp'))
const sticker = addSakuraStickerMetadata(sampleSticker, { botName: 'Outro nome', userName: 'Pessoa real' })
const metadataText = sticker.toString('utf8')
assert.ok((metadataText.match(/sakura-md ❅ Pessoa real/g) || []).length >= 2)
assert.match(metadataText, /Criada pela Sakura-MD com carinho/)

let centrallySent = null
const fakeStickerSocket = {
  sendMessage: async (_jid, content) => {
    centrallySent = content
    return { key: { id: 'STICKER-V105' }, message: content }
  },
  relayMessage: async () => 'relay-v105'
}
installMentionResolver(fakeStickerSocket, null)
const customSticker = addSakuraStickerMetadata(sampleSticker, { packName: 'Nome antigo', author: 'Autor antigo' })
await fakeStickerSocket.sendMessage('5511999999999@s.whatsapp.net', { sticker: customSticker })
const centralText = centrallySent.sticker.toString('utf8')
assert.match(centralText, /Nome antigo/)
assert.match(centralText, /Autor antigo/)
assert.doesNotMatch(centralText, /sakura-md ❅ usuario/)

const files = {
  status: await fs.readFile(path.join(root, 'commands', 'group-status.js'), 'utf8'),
  delstatus: await fs.readFile(path.join(root, 'commands', 'delstatusgp.js'), 'utf8'),
  protections: await fs.readFile(path.join(root, 'commands', 'protections.js'), 'utf8'),
  automations: await fs.readFile(path.join(root, 'commands', 'automations.js'), 'utf8'),
  conversions: await fs.readFile(path.join(root, 'commands', 'sticker-convert.js'), 'utf8'),
  media: await fs.readFile(path.join(root, 'data', 'media.js'), 'utf8'),
  social: await fs.readFile(path.join(root, 'data', 'social-downloader.js'), 'utf8'),
  installer: await fs.readFile(path.join(root, 'install.sh'), 'utf8')
}

assert.match(files.status, /sendZenkGroupStatus/)
assert.match(files.status, /zenk-group-status/)
assert.match(files.status, /normalizeStatusVideo/)
assert.match(files.delstatus, /deleteGroupStatus/)
assert.match(files.protections, /Ativar AntiLink/)
assert.match(files.protections, /Desativar AntiLink/)
assert.match(files.automations, /togglePanel/)
assert.match(files.conversions, /name: 'toimg'/)
assert.match(files.conversions, /'tovideo'/)
assert.match(files.media, /fps: 60, quality: 66/)
assert.doesNotMatch(files.media, /fps: 45, quality:/)
assert.doesNotMatch(files.social, /tryYtDlp|YTDLP_PATH|yt-dlp/)
assert.doesNotMatch(files.installer, /yt-dlp|pip install/)

const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.version, '1.2.3')

closeProtectionStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ v1.2.3: AntiLink, status de grupo, metadados por remetente, 60 FPS VIP e conversões validados')
