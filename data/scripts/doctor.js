import fs from 'node:fs'
import { settings, readConfig } from '../settings.js'
import { assertFfmpeg } from '../media.js'

const config = readConfig()
for (const key of ['botName', 'botNumber', 'ownerNumber', 'prefix']) {
  if (!config[key]) throw new Error(`Missing config field: ${key}`)
}
for (const directory of [settings.configDir, settings.storageDir, settings.sessionDir, settings.logsDir, settings.cacheDir, settings.tmpDir]) {
  fs.mkdirSync(directory, { recursive: true })
}
await assertFfmpeg()
console.log(`✅ Configuration: ${config.botName} | prefix ${config.prefix} | owner ${config.ownerNumber}`)
console.log(`✅ Storage: ${settings.storageDir}`)
console.log(`✅ FFmpeg: ${settings.ffmpegPath}`)
