import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runProcess } from './media.js'
import { settings } from './settings.js'

const memory = new Map()

export async function prepareLegacyAudio(file, logger) {
  const stat = await fs.stat(file)
  const cacheDir = path.join(settings.audioDir, 'legacy', '.ptt-cache')
  const hash = createHash('sha1').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 14)
  const output = path.join(cacheDir, `${path.basename(file, path.extname(file))}-${hash}.ogg`)
  const key = `${output}:${stat.size}`
  if (memory.has(key)) return memory.get(key)
  const promise = (async () => {
    await fs.mkdir(cacheDir, { recursive: true })
    try { if ((await fs.stat(output)).size > 128) return await fs.readFile(output) } catch {}
    const tmp = `${output}.tmp.ogg`
    await runProcess(settings.ffmpegPath, ['-hide_banner','-loglevel','error','-y','-i',file,'-vn','-map_metadata','-1','-c:a','libopus','-application','voip','-b:a','48k','-vbr','on','-compression_level','10','-frame_duration','20','-ar','48000','-ac','1','-f','ogg',tmp], { timeoutMs: 120000, logger })
    await fs.rename(tmp, output)
    return fs.readFile(output)
  })().catch(error => { memory.delete(key); throw error })
  memory.set(key, promise)
  return promise
}
