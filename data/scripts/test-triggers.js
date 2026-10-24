import {
  getTriggerStats,
  getTriggersDatabase,
  matchAudioTrigger,
  matchStickerTrigger,
  normalizeTrigger,
  reloadTriggers,
  updateTriggersDatabase
} from '../triggers.js'
import { unwrapMessage } from '../messages.js'
import { createMessageHandler } from '../handler.js'

await reloadTriggers()
const stats = getTriggerStats()
if (stats.audioAvailable < 100) throw new Error(`Catálogo de áudio incompleto: ${stats.audioAvailable}`)
if (stats.audioEnabled < 100) throw new Error(`Catálogo de memes não foi ativado: ${stats.audioEnabled}`)
if (stats.stickerAvailable < 15 || stats.stickerEnabled < 14) throw new Error(`Figurinhas automáticas incompletas: ${JSON.stringify(stats)}`)

if (normalizeTrigger('  BÓM   DIAAA!!! ') !== 'bom dia') throw new Error('Normalização de texto alongado/pontuação falhou')
if (normalizeTrigger('Ixi KKKKK!!!') !== 'ixi kkk') throw new Error(`Normalização de risada destruiu o gatilho: ${normalizeTrigger('Ixi KKKKK!!!')}`)
const morning = matchAudioTrigger('BOM DIAAA!!!', { isGroup: true, mentionedBot: false })
if (morning?.value?.id !== 'bomdia') throw new Error(`Bom dia não resolveu para bomdia: ${morning?.value?.id}`)
for (const [phrase, expectedId] of [['palmeiras', 'palmeiras'], ['free fire', 'freefire'], ['pernambucano', 'pernambucano']]) {
  const meme = matchAudioTrigger(phrase, { isGroup: true, mentionedBot: false })
  if (meme?.value?.id !== expectedId) throw new Error(`Áudio de meme não carregado: ${phrase} => ${meme?.value?.id}`)
}

const sakuraWithoutMention = matchAudioTrigger('sakura', { isGroup: true, mentionedBot: false })
if (sakuraWithoutMention) throw new Error('Gatilho Sakura disparou sem menção')
const sakuraMention = matchAudioTrigger('sakura', { isGroup: true, mentionedBot: true })
if (sakuraMention?.value?.id !== 'qsaco') throw new Error('Gatilho Sakura com menção não resolveu para qsaco')
const sticker = matchStickerTrigger('SIMMMM!!!', { isGroup: true })
if (sticker?.value?.id !== 'sim') throw new Error(`Figurinha sim não reconhecida: ${sticker?.value?.id}`)
if (matchStickerTrigger('o status disse que está online sim e tudo certo', { isGroup: true })) throw new Error('Gatilho curto sim disparou dentro de texto longo')

const laughterAudio = matchAudioTrigger('Ixi kkkkk', { isGroup: true })
if (laughterAudio) throw new Error(`Risada ainda disparou áudio: ${laughterAudio.value?.id}`)
const laughterSticker = matchStickerTrigger('Ixi kkkkk', { isGroup: true })
if (laughterSticker?.value?.id !== 'risada') throw new Error(`Risada não resolveu para figurinha: ${laughterSticker?.value?.id}`)
const ksks = matchStickerTrigger('KSKSKSKS', { isGroup: true })
if (ksks?.value?.id !== 'risada') throw new Error(`Risada em capslock/ksks não resolveu: ${ksks?.value?.id}`)
const greetingSticker = matchStickerTrigger('BOA NOITE!!!', { isGroup: true })
if (greetingSticker?.value?.id !== 'boanoite') throw new Error(`Boa noite não resolveu para figurinha: ${greetingSticker?.value?.id}`)

const morningSticker = matchStickerTrigger('BOM DIAAA!!!', { isGroup: true, mentionedBot: false })
if (morningSticker?.value?.id !== 'bomdia' || morningSticker.matched !== morning.matched) {
  throw new Error(`Bom dia não formou combo: audio=${morning?.matched} sticker=${morningSticker?.matched}`)
}
const compliment = matchStickerTrigger('A Sakura é linda demais', { isGroup: true })
if (compliment?.value?.id !== 'elogiosakura') throw new Error(`Elogio da Sakura não reconhecido: ${compliment?.value?.id}`)
const profanity = matchStickerTrigger('que porra foi essa', { isGroup: true, chat: 'teste-palavrao@g.us', sender: '111' })
if (profanity?.value?.id !== 'palavrao') throw new Error(`Palavrão não reconhecido: ${profanity?.value?.id}`)
const greetingExact = matchStickerTrigger('oi', { isGroup: true })
if (greetingExact?.value?.id !== 'oie') throw new Error(`Oi não reconhecido: ${greetingExact?.value?.id}`)
if (matchStickerTrigger('foi uma coisa normal', { isGroup: true })) throw new Error('Gatilho oi disparou dentro de outra palavra')
const firstConflict = matchStickerTrigger('cala boca idiota', { isGroup: true, chat: 'treta-contexto@g.us', sender: '111' })
if (firstConflict?.value?.id !== 'palavrao') throw new Error(`Primeira ofensa deveria usar palavrao: ${firstConflict?.value?.id}`)
const secondConflict = matchStickerTrigger('vai se foder', { isGroup: true, chat: 'treta-contexto@g.us', sender: '222' })
if (secondConflict?.value?.id !== 'treta' || !secondConflict.contextual) throw new Error(`Treta contextual não detectada: ${secondConflict?.value?.id}`)

// Confirma que duas mídias com a mesma frase podem coexistir no plano de disparo.
const original = await getTriggersDatabase()
try {
  await updateTriggersDatabase(db => {
    db.audio.teste ||= { file: 'legacy/acorda.mp3', phrases: ['combo sakura'], enabled: false, ptt: true, cooldownMs: 1000, preset: 'extra' }
    db.stickers.teste ||= { file: 'legacy/bomdia.webp', phrases: ['combo sakura'], enabled: false, cooldownMs: 1000, preset: 'extra' }
    db.audio.teste.phrases = ['combo sakura']
    db.audio.teste.enabled = true
    db.audio.teste.lockedDisabled = false
    db.stickers.teste.phrases = ['combo sakura']
    db.stickers.teste.enabled = true
    db.stickers.teste.exactOnly = false
  })
  const comboAudio = matchAudioTrigger('combo sakura', { isGroup: true, mentionedBot: false })
  const comboSticker = matchStickerTrigger('combo sakura', { isGroup: true, mentionedBot: false })
  if (comboAudio?.value?.id !== 'teste' || comboSticker?.value?.id !== 'teste' || comboAudio.matched !== comboSticker.matched) {
    throw new Error('Gatilho combinado áudio+figurinha não foi resolvido como par')
  }

  const sent = []
  const fakeLogger = new Proxy({}, { get: () => () => {} })
  const sock = {
    user: { id: '5581999999999@s.whatsapp.net' },
    sakuraResolveNumber: async jid => String(jid).replace(/\D/g, ''),
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options })
      return { key: { id: `AUTO-${sent.length}`, remoteJid: jid }, message: content }
    }
  }
  const handler = await createMessageHandler(sock, fakeLogger)
  await handler({
    key: { id: 'COMBO-TRIGGER-1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: 'combo sakura' }
  }, 'notify')
  const deadline = Date.now() + 2_000
  while (sent.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  if (!sent.some(item => item.content?.audio) || !sent.some(item => item.content?.sticker)) {
    throw new Error(`O handler não enviou áudio e figurinha juntos: ${sent.map(item => Object.keys(item.content || {})).join(',')}`)
  }
  if (!sent[0]?.content?.sticker || !sent[1]?.content?.audio) {
    throw new Error(`Ordem do combo incorreta: ${sent.map(item => Object.keys(item.content || {})).join(' -> ')}`)
  }
} finally {
  await updateTriggersDatabase(db => {
    db.audio.teste = original.audio.teste
    db.stickers.teste = original.stickers.teste
  })
}

const nested = unwrapMessage({ associatedChildMessage: { message: { conversation: 'teste' } } })
if (nested.content?.conversation !== 'teste' || !nested.wrappers.includes('associatedChildMessage')) throw new Error('associatedChildMessage não foi desembrulhada')

console.log(`✅ Automáticos: ${stats.audioEnabled}/${stats.audioAvailable} áudios, ${stats.stickerEnabled}/${stats.stickerAvailable} figurinhas, risada somente por sticker e combinação aprovados`)
