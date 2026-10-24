import { randomUUID } from 'node:crypto'

function assertWebp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('WebP inválido')
  }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function writeUInt24LE(buffer, value, offset) {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >> 8) & 0xff
  buffer[offset + 2] = (value >> 16) & 0xff
}

function readChunks(buffer) {
  assertWebp(buffer)
  const chunks = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const fourCC = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > buffer.length) break
    chunks.push({ fourCC, data: Buffer.from(buffer.subarray(start, end)) })
    offset = end + (size % 2)
  }
  return chunks
}

function chunkBuffer(fourCC, data) {
  const header = Buffer.alloc(8)
  header.write(fourCC, 0, 4, 'ascii')
  header.writeUInt32LE(data.length, 4)
  return Buffer.concat([header, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)])
}

function dimensions(chunks) {
  const vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X')
  if (vp8x?.data?.length >= 10) return { width: readUInt24LE(vp8x.data, 4) + 1, height: readUInt24LE(vp8x.data, 7) + 1 }
  const vp8 = chunks.find(chunk => chunk.fourCC === 'VP8 ')
  if (vp8?.data?.length >= 10) return { width: vp8.data.readUInt16LE(6) & 0x3fff, height: vp8.data.readUInt16LE(8) & 0x3fff }
  const vp8l = chunks.find(chunk => chunk.fourCC === 'VP8L')
  if (vp8l?.data?.length >= 5) {
    const [b1, b2, b3, b4] = vp8l.data.subarray(1, 5)
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) }
  }
  return { width: 512, height: 512 }
}

function cleanEmojiList(values = []) {
  const list = Array.isArray(values) ? values : String(values || '').split(',')
  return [...new Set(list.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 8)
}

function exifData(packName, author, { emojis = ['❄️', '💎', '🧊'], description = '', customPackName = '', customPublisher = '' } = {}) {
  const metadata = {
    'sticker-pack-id': `sakura-${randomUUID()}`,
    'sticker-pack-name': String(packName || 'Sakurajima-Bot').slice(0, 128),
    'sticker-pack-publisher': String(author || '💎 Feita pela: Sakurajima-Bot').slice(0, 128),
    emojis: cleanEmojiList(emojis).length ? cleanEmojiList(emojis) : ['❄️', '💎', '🧊']
  }
  if (customPackName) metadata['sakura-custom-pack-name'] = String(customPackName).slice(0, 128)
  if (customPublisher) metadata['sakura-custom-publisher'] = String(customPublisher).slice(0, 128)
  const cleanDescription = String(description || '').trim().slice(0, 512)
  if (cleanDescription) {
    // Mantemos a chave EXIF usada pela Sakura e um alias reconhecido por
    // implementações de sticker packs. O WhatsApp oficial garante nome e
    // publisher; consumidores que leem descrição recebem o bloco completo.
    metadata['sticker-pack-description'] = cleanDescription
    metadata.packDescription = cleanDescription
    metadata.description = cleanDescription
  }
  const payload = Buffer.from(JSON.stringify(metadata), 'utf8')
  const header = Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x41,0x57,7,0,0,0,0,0,0x16,0,0,0])
  header.writeUInt32LE(payload.length, 14)
  return Buffer.concat([header, payload])
}

function cleanStickerLine(value = '', fallback = '') {
  const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
  return clean || fallback
}

export function buildSakuraStickerDescription({ userName = '', groupName = '' } = {}) {
  const requester = cleanStickerLine(userName, 'Usuário')
  const group = cleanStickerLine(groupName, 'Conversa privada')
  return [
    `❄️ Enviado por: ${requester}`,
    '💎 Feita pela: Sakurajima-Bot',
    `🧊 Grupo: ${group}`
  ].join('\n')
}


function visibleStickerFields(description = '', fallbackUser = 'Usuário') {
  const text = String(description || '').trim()
  const requester = text.match(/Enviado por:\s*([^\n]+)/i)?.[1]?.replace(/\*/g, '').trim() || fallbackUser
  const group = text.match(/Grupo:\s*([^\n]+)/i)?.[1]?.replace(/\*/g, '').trim() || 'Conversa privada'
  // O WhatsApp exibe nome do pacote e publisher. Mantemos as três linhas
  // importantes no EXIF e duplicamos todas nos dois campos visíveis.
  return {
    packName: `❄️ Enviado por: ${requester}`.slice(0, 128),
    publisher: `💎 Feita pela: Sakurajima-Bot\n🧊 Grupo: ${group}`.slice(0, 128)
  }
}


function exactExifData(packName = '', publisher = '', emojis = []) {
  const metadata = {
    'sticker-pack-id': `sakura-${randomUUID()}`,
    'sticker-pack-name': String(packName || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128),
    'sticker-pack-publisher': String(publisher ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128),
    emojis: cleanEmojiList(emojis)
  }
  const payload = Buffer.from(JSON.stringify(metadata), 'utf8')
  const header = Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x41,0x57,7,0,0,0,0,0,0x16,0,0,0])
  header.writeUInt32LE(payload.length, 14)
  return Buffer.concat([header, payload])
}

function rebuildWebpWithExif(buffer, exifBuffer) {
  const chunks = readChunks(buffer).filter(chunk => chunk.fourCC !== 'EXIF')
  let vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X')
  if (!vp8x) {
    const size = dimensions(chunks)
    const data = Buffer.alloc(10)
    writeUInt24LE(data, Math.max(0, size.width - 1), 4)
    writeUInt24LE(data, Math.max(0, size.height - 1), 7)
    vp8x = { fourCC: 'VP8X', data }
    chunks.unshift(vp8x)
  }
  vp8x.data[0] |= 0x08
  if (chunks.some(chunk => ['ANIM', 'ANMF'].includes(chunk.fourCC))) vp8x.data[0] |= 0x02
  const exif = { fourCC: 'EXIF', data: exifBuffer }
  const lastImage = chunks.reduce((last, chunk, index) => ['VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF'].includes(chunk.fourCC) ? index : last, 0)
  chunks.splice(lastImage + 1, 0, exif)
  const body = Buffer.concat(chunks.map(chunk => chunkBuffer(chunk.fourCC, chunk.data)))
  const header = Buffer.alloc(12)
  header.write('RIFF', 0); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8)
  return Buffer.concat([header, body])
}

export function addExactStickerMetadata(buffer, { packName = '', publisher = '', emojis = [] } = {}) {
  return rebuildWebpWithExif(buffer, exactExifData(packName, publisher, emojis))
}

export function readSakuraStickerMetadata(buffer) {
  for (const chunk of readChunks(buffer)) {
    if (chunk.fourCC !== 'EXIF' || !chunk.data?.length) continue
    const start = chunk.data.indexOf(0x7b) // {
    if (start < 0) continue
    try { return JSON.parse(chunk.data.subarray(start).toString('utf8')) } catch {}
  }
  return null
}

export function stripStickerMetadata(buffer) {
  const chunks = readChunks(buffer).filter(chunk => chunk.fourCC !== 'EXIF')
  const vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X')
  if (vp8x?.data?.length) vp8x.data[0] &= ~0x08
  const body = Buffer.concat(chunks.map(chunk => chunkBuffer(chunk.fourCC, chunk.data)))
  const header = Buffer.alloc(12)
  header.write('RIFF', 0); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8)
  return Buffer.concat([header, body])
}

export function addSakuraStickerMetadata(buffer, { botName, botNumber, userName = '', userNumber = '', packName = '', author = '', emojis = ['❄️', '💎', '🧊'], description = '' } = {}) {
  const chunks = readChunks(buffer).filter(chunk => chunk.fourCC !== 'EXIF')
  let vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X')
  if (!vp8x) {
    const size = dimensions(chunks)
    const data = Buffer.alloc(10)
    writeUInt24LE(data, Math.max(0, size.width - 1), 4)
    writeUInt24LE(data, Math.max(0, size.height - 1), 7)
    vp8x = { fourCC: 'VP8X', data }
    chunks.unshift(vp8x)
  }
  vp8x.data[0] |= 0x08
  if (chunks.some(chunk => ['ANIM', 'ANMF'].includes(chunk.fourCC))) vp8x.data[0] |= 0x02
  // "usuario" é um espaço reservado: nas figurinhas criadas por comando,
  // ele é substituído pelo nome real do remetente. Metadados explícitos são
  // preservados para auto-respostas e para o comando VIP `.take`.
  const cleanUserName = String(userName || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 55)
  const fallbackUser = cleanUserName || (String(userNumber || '').replace(/\D/g, '').slice(-8) ? `usuário ${String(userNumber || '').replace(/\D/g, '').slice(-4)}` : 'usuário')
  const defaultIdentity = 'Sakurajima-Bot'
  const customPackName = String(packName || '').trim().slice(0, 80)
  const customPublisher = String(author || '').trim().slice(0, 128)
  const prettyDescription = String(description || '').trim().slice(0, 512)
  const visible = visibleStickerFields(prettyDescription, fallbackUser)
  const pack = prettyDescription ? visible.packName : String(customPackName || defaultIdentity).trim().slice(0, 128)
  const publisher = prettyDescription ? visible.publisher : String(customPublisher || '💎 Feita pela: Sakurajima-Bot').trim().slice(0, 128)
  const exif = { fourCC: 'EXIF', data: exifData(pack, publisher, {
    emojis,
    description: prettyDescription,
    customPackName,
    customPublisher
  }) }
  const lastImage = chunks.reduce((last, chunk, index) => ['VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF'].includes(chunk.fourCC) ? index : last, 0)
  chunks.splice(lastImage + 1, 0, exif)
  const body = Buffer.concat(chunks.map(chunk => chunkBuffer(chunk.fourCC, chunk.data)))
  const header = Buffer.alloc(12)
  header.write('RIFF', 0); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8)
  return Buffer.concat([header, body])
}
