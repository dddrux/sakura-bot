import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import adminCommand from '../../commands/admin.js'
import { settings } from '../settings.js'
import { readSakuraStickerMetadata } from '../sticker-metadata.js'
import { getStickerTriggerBuffer, getTriggersDatabase, matchAudioTrigger, matchStickerTrigger, reloadTriggers } from '../triggers.js'

const expected = [
  'banho', 'boanoite', 'boatarde', 'bomdia', 'calabocasakura', 'treta',
  'elogiosakura', 'ban', 'risada', 'oie', 'presente', 'sim', 'sono', 'tedio', 'palavrao'
]

for (const id of expected) {
  const file = path.join(settings.stickerDir, 'legacy', `${id}.webp`)
  await fs.access(file)
  const metadata = await sharp(file).metadata()
  if (metadata.format !== 'webp' || metadata.width !== 512 || metadata.height !== 512) {
    throw new Error(`Figurinha inválida ${id}: ${JSON.stringify(metadata)}`)
  }
}

await reloadTriggers()
const db = await getTriggersDatabase()
for (const id of expected.filter(id => id !== 'ban')) {
  if (!db.stickers?.[id]?.enabled) throw new Error(`Figurinha automática ${id} não está ativa`)
}
if (db.stickers?.ban?.enabled || db.stickers?.ban?.commandOnly !== true) {
  throw new Error('Figurinha ban deveria ser exclusiva do comando')
}

const metadataEntry = matchStickerTrigger('bom dia', { isGroup: true })?.value
const metadataBuffer = await getStickerTriggerBuffer(metadataEntry, true)
const stickerMetadata = readSakuraStickerMetadata(metadataBuffer)
if (stickerMetadata?.['sticker-pack-name'] !== 'drux domina' || stickerMetadata?.['sticker-pack-publisher'] !== '') {
  throw new Error(`Metadados automáticos incorretos: ${JSON.stringify(stickerMetadata)}`)
}

for (const id of ['risada', 'rachei', 'rsrsrs', 'hehe', 'engracado']) {
  if (db.audio?.[id]?.enabled || db.audio?.[id]?.lockedDisabled !== true) {
    throw new Error(`Áudio de risada ${id} não foi bloqueado`)
  }
}

for (const phrase of ['bom dia', 'boa tarde', 'boa noite']) {
  const audio = matchAudioTrigger(phrase, { isGroup: true })
  const sticker = matchStickerTrigger(phrase, { isGroup: true })
  if (!audio || !sticker || audio.matched !== sticker.matched) {
    throw new Error(`Combo não resolvido para ${phrase}: ${audio?.matched}/${sticker?.matched}`)
  }
}

for (const phrase of ['KKKKKKKK', 'KSKSKSKSKS', 'KAKAKAKKA', 'RSRSRSRS']) {
  if (matchAudioTrigger(phrase, { isGroup: true })) throw new Error(`Risada disparou áudio: ${phrase}`)
  if (matchStickerTrigger(phrase, { isGroup: true })?.value?.id !== 'risada') {
    throw new Error(`Risada não disparou figurinha: ${phrase}`)
  }
}

const sent = []
const sock = {
  groupParticipantsUpdate: async (jid, targets, action) => {
    if (jid !== '120363000000000000@g.us' || action !== 'remove' || !targets.length) throw new Error('Ação de ban inválida')
    return [{ status: '200' }]
  },
  sendMessage: async (jid, content, options) => {
    sent.push({ jid, content, options })
    return { key: { id: `BAN-${sent.length}`, remoteJid: jid }, message: content }
  }
}
const logger = new Proxy({}, { get: () => () => {} })
const msg = {
  key: { id: 'BAN-COMMAND', remoteJid: '120363000000000000@g.us', participant: '5511999999999@s.whatsapp.net', fromMe: false },
  message: {
    extendedTextMessage: {
      text: '.ban @5511888888888',
      contextInfo: { mentionedJid: ['5511888888888@s.whatsapp.net'] }
    }
  }
}
await adminCommand.execute({
  sock,
  msg,
  args: ['@5511888888888'],
  rawArgs: '@5511888888888',
  text: '.ban @5511888888888',
  settings,
  metadata: { participants: [] },
  logger
})
if (!sent.some(item => item.content?.audio) || !sent.some(item => item.content?.sticker)) {
  throw new Error(`Ban não enviou áudio e figurinha: ${sent.map(item => Object.keys(item.content || {})).join(',')}`)
}

console.log(`✅ Pacote automático: ${expected.length} figurinhas, combos de saudação, risada sem áudio, treta e ban aprovados`)
