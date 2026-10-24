import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v0356-'))
process.env.SAKURA_STICKER_DB = path.join(temporary, 'stickers.db')
process.env.SAKURA_STICKER_LIBRARY_DIR = path.join(temporary, 'library')
const imageMagick = ['magick', 'convert'].find(command => {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore', timeout: 5000 })
  return !result.error && result.status === 0
})
if (imageMagick) process.env.SAKURA_FORCE_BRAT_FALLBACK = '1'

const {
  rememberRecentStickerMedia,
  listRecentStickerMedia,
  consumeRecentStickerMedia,
  recentStickerMediaStats
} = await import('../sticker-batch-cache.js')
const { addSakuraStickerMetadata, stripStickerMetadata } = await import('../sticker-metadata.js')
const {
  setStickerLibraryEnabled,
  saveStickerToLibrary,
  stickerLibraryStatus,
  getRandomSticker,
  clearStickerLibrary
} = await import('../sticker-library.js')
const { convertToSticker, createStaticBratSticker } = await import('../media.js')
const { settings } = await import('../settings.js')

function fakeMedia(id, kind = 'image') {
  const node = kind === 'video'
    ? { videoMessage: { seconds: 2, fileLength: 1000 } }
    : { imageMessage: { fileLength: 1000 } }
  return { key: { id, remoteJid: 'grupo@g.us', participant: '111@s.whatsapp.net' }, message: node }
}

const now = Date.now()
if (!rememberRecentStickerMedia(fakeMedia('A'), 'grupo', '111', now)) throw new Error('primeira mídia não entrou no cache')
rememberRecentStickerMedia(fakeMedia('B'), 'grupo', '111', now + 1)
rememberRecentStickerMedia(fakeMedia('C'), 'grupo', '222', now + 2)
if (listRecentStickerMedia('grupo', '111', 20, now + 3).length !== 2) throw new Error('cache não isolou o usuário 111')
if (listRecentStickerMedia('grupo', '222', 20, now + 3).length !== 1) throw new Error('cache não isolou o usuário 222')
const consumed = consumeRecentStickerMedia('grupo', '111', 1, now + 3)
if (consumed.length !== 1 || recentStickerMediaStats('grupo', '111', now + 3).count !== 1) throw new Error('consumo parcial do lote falhou')
if (listRecentStickerMedia('grupo', '111', 20, now + 11 * 60_000).length !== 0) throw new Error('TTL do lote não expirou')

const sourceImage = await fs.readFile(path.join(settings.menuImageDir, 'sakura-logo.png'))
const round = await convertToSticker(sourceImage, 'image', null, { fit: 'contain', round: true })
const text = await convertToSticker(sourceImage, 'image', null, { fit: 'cover', text: 'Sakura Parte 6' })
for (const [label, buffer] of [['redonda', round], ['texto', text]]) {
  if (buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP') throw new Error(`${label} não gerou WebP`)
}

const visual = stripStickerMetadata(round)
const first = addSakuraStickerMetadata(visual, { packName: 'Pacote A', author: 'Autor A', emojis: ['🌸'], description: 'Descrição A' })
const second = addSakuraStickerMetadata(visual, { packName: 'Pacote B', author: 'Autor B', emojis: ['❄️'], description: 'Descrição B' })
if (!first.includes(Buffer.from('Pacote A')) || !first.includes(Buffer.from('Autor A')) || !first.includes(Buffer.from('Descrição A'))) throw new Error('metadados personalizados não foram gravados')

await setStickerLibraryEnabled(true, 'teste')
const saved = await saveStickerToLibrary(first, { source: 'test', creator: '111', chat: 'grupo' })
const duplicate = await saveStickerToLibrary(second, { source: 'test', creator: '111', chat: 'grupo' })
const stats = await stickerLibraryStatus()
if (!saved.saved || !duplicate.duplicate || stats.count !== 1 || stats.duplicates !== 1) throw new Error(`deduplicação falhou: ${JSON.stringify({ saved, duplicate, stats })}`)
const random = await getRandomSticker()
if (!random?.buffer?.length) throw new Error('sorteio da biblioteca falhou')

let fallback = 'não testado'
if (imageMagick) {
  const brat = await createStaticBratSticker('ARM funcionando', { theme: 'verde' })
  if (brat.subarray(0, 4).toString() !== 'RIFF' || brat.subarray(8, 12).toString() !== 'WEBP') throw new Error('fallback do Brat não gerou WebP')
  fallback = imageMagick
}

await clearStickerLibrary()
await fs.rm(temporary, { recursive: true, force: true })
console.log(`✅ Parte 6: cache isolado/TTL, filtros, metadados, biblioteca deduplicada e Brat fallback (${fallback}) aprovados`)
