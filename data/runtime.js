import { openDatabase } from './database.js'
import { settings } from './settings.js'

const defaults = {
  version: 3,
  theme: 'sakura-md-blue',
  ownerDisplayName: 'Drux',
  autoReplyAudio: true,
  autoReplySticker: true,
  autoStickerRandom: true,
  autoStickerLibraryChance: 0.45,
  autoStickerRecentLimit: 4,
  stickerMetadata: true,
  panelEnabled: true,
  lastUpdate: null
}
const store = openDatabase(settings.runtimeDb, defaults)
let cache = await store.read()
if (cache.theme !== 'sakura-md-blue' || Number(cache.version || 0) < 3) {
  await store.update(db => {
    db.version = 3
    db.theme = 'sakura-md-blue'
  })
  cache = await store.read()
}

export function runtimeSettings() { return cache }
export async function updateRuntimeSettings(values = {}) {
  await store.update(db => {
    for (const key of Object.keys(defaults)) {
      if (key in values && key !== 'version') db[key] = values[key]
    }
  })
  cache = await store.read()
  return cache
}
