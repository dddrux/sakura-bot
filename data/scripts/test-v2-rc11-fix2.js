import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const groupSource = await fs.readFile(new URL('../group-automations.js', import.meta.url), 'utf8')
assert.match(groupSource, /normalizeReceptionParticipant/, 'recepção precisa normalizar GroupParticipant com LID/phoneNumber')
assert.match(groupSource, /participant\.phoneNumber|phoneNumber/, 'recepção deve preferir phoneNumber quando o evento vier em LID')
const profileUi = await fs.readFile(new URL('../economy-ui.js', import.meta.url), 'utf8')
assert.doesNotMatch(profileUi, /\*jid:\*/, '.perfil não deve mais exibir JID')

const economySource = await fs.readFile(new URL('../economy.js', import.meta.url), 'utf8')
for (const [item, emoji] of [['selo','🛡️'],['energia','🍵'],['trevo','🍀'],['cupom','🎟️'],['chave','🗝️'],['rosa','🌹'],['madeira','🪵'],['cristal','💎'],['fita','🎀'],['dourada','✨']]) {
  assert.match(economySource, new RegExp(`${item}: \\{ name: '[^']+', icon: '${emoji}'`), `item ${item} precisa de emoji representativo`)
}

const convertCommand = await fs.readFile(new URL('../../commands/sticker-convert.js', import.meta.url), 'utf8')
assert.match(convertCommand, /aguarde\.mp3/, '.toimg/.tomp4 precisam usar áudio aguarde um momento')
assert.match(convertCommand, /prepareLegacyAudio/, 'áudio aguarde precisa ser preparado como PTT compatível')

const convertHelper = await fs.readFile(new URL('../sticker-convert.js', import.meta.url), 'utf8')
assert.match(convertHelper, /stripStickerMetadata/, 'conversor precisa limpar EXIF antes do FFmpeg')
assert.match(convertHelper, /detectMediaFormat/, 'conversor precisa detectar o formato real da mídia')
assert.match(convertHelper, /resolveImageMagick|sharp/i, 'tomp4 precisa de fallback fora do decoder WebP do FFmpeg')
assert.doesNotMatch(convertHelper, /Não consegui converter a figurinha para MP4 neste host\. FFmpeg H\.264:/, 'não deve despejar stderr gigante no usuário')

const handler = await fs.readFile(new URL('../handler.js', import.meta.url), 'utf8')
assert.match(handler, /auto-media-balance/, 'handler precisa usar gerenciador adaptativo das respostas automáticas')
assert.match(handler, /evaluateAutoMedia/, 'handler precisa avaliar frequência antes de enviar áudio/figurinha')


const { evaluateAutoMedia, resetAutoMediaBalance } = await import('../auto-media-balance.js')
resetAutoMediaBalance()
const firstMedia = evaluateAutoMedia({ chat: '120363-test@g.us', audio: true, sticker: true, audioId: 'oi-audio', stickerId: 'oi-sticker', combined: true, now: 1_000_000 })
assert.equal(firstMedia.audio, true)
assert.equal(firstMedia.sticker, true)
const burstMedia = evaluateAutoMedia({ chat: '120363-test@g.us', audio: true, sticker: true, audioId: 'outro-audio', stickerId: 'outro-sticker', combined: true, now: 1_005_000 })
assert.equal(burstMedia.audio || burstMedia.sticker, false, 'rajada automática precisa ser suprimida')
const balancedMedia = evaluateAutoMedia({ chat: '120363-test@g.us', audio: true, sticker: true, audioId: 'outro-audio', stickerId: 'outro-sticker', combined: true, now: 1_060_000 })
assert.equal(Boolean(balancedMedia.audio) !== Boolean(balancedMedia.sticker), true, 'combo recente deve virar apenas uma mídia para não enjoar')

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-backup-first-'))
await fs.mkdir(path.join(temp, 'backup/config'), { recursive: true })
await fs.mkdir(path.join(temp, 'backup/storage'), { recursive: true })
await fs.writeFile(path.join(temp, 'backup/config/sakura.config.json'), JSON.stringify({ prefix: '!', owner: '5581000000000' }))
await fs.writeFile(path.join(temp, 'backup/storage/sakura-db.json'), JSON.stringify({ schemaVersion: 2, namespaces: { test: { ok: true } } }))
const { restorePersistentBackup } = await import('../backup-manager.js')
const restored = await restorePersistentBackup({ rootDir: temp, release: '2.0.0-rc.11-test' })
assert.equal(restored.restored, true, 'backup da raiz deve restaurar automaticamente na primeira inicialização')
assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'config/sakura.config.json'), 'utf8')).prefix, '!')
assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'storage/sakura-db.json'), 'utf8')).namespaces.test.ok, true)
await fs.rm(temp, { recursive: true, force: true })

console.log('✅ RC11 fix2: recepção LID, economia, perfil, mídia, anti-spam e restore inicial especificados')
