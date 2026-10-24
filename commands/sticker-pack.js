import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const STICKERS_DIR = path.join(process.cwd(), 'data', 'stickers')

let cache = { files: null, at: 0 }
const CACHE_MS = 30_000

async function listStickers() {
  const now = Date.now()
  if (cache.files && now - cache.at < CACHE_MS) return cache.files

  try {
    const entries = await fs.readdir(STICKERS_DIR)
    const files = entries
      .filter(name => name.endsWith('.webp'))
      .map(name => path.join(STICKERS_DIR, name))
    cache = { files, at: now }
    return files
  } catch {
    cache = { files: [], at: now }
    return []
  }
}

export function invalidateStickerCache() {
  cache = { files: null, at: 0 }
}

export async function countStickers() {
  return (await listStickers()).length
}

export async function buildRandomPack({ size = 8 } = {}) {
  const all = await listStickers()
  if (!all.length) return []

  const pool = [...all]
  const picks = []
  const n = Math.min(size, pool.length)

  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(Math.random() * pool.length)
    picks.push(pool.splice(idx, 1)[0])
  }

  return picks
}

// Grava uma figurinha nova (chamado quando o bot recebe sticker).
// Retorna null se já existia, ou o caminho salvo.
export async function saveSticker(buffer) {
  if (!buffer?.length) return null
  const hash = crypto.createHash('sha1').update(buffer).digest('hex')
  const file = path.join(STICKERS_DIR, `${hash}.webp`)

  await fs.mkdir(STICKERS_DIR, { recursive: true })

  try {
    await fs.access(file)
    return null
  } catch {
    // ainda não existe
  }

  await fs.writeFile(file, buffer)
  invalidateStickerCache()
  return file
}
