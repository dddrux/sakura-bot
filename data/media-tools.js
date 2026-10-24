import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { getQuotedMessage, unwrapMessage } from './messages.js'
import { runProcess } from './media.js'

function target(msg) {
  const quoted = getQuotedMessage(msg)
  return quoted || msg
}
function kindOf(message = {}) {
  const { content } = unwrapMessage(message)
  if (content.audioMessage) return 'audio'
  if (content.videoMessage) return 'video'
  if (content.imageMessage) return 'image'
  if (content.stickerMessage) return 'sticker'
  return ''
}
function extFor(kind) { return kind === 'audio' ? '.ogg' : kind === 'video' ? '.mp4' : kind === 'image' ? '.jpg' : kind === 'sticker' ? '.webp' : '.bin' }
async function ensureTemp(){await fs.mkdir(settings.tmpDir,{recursive:true})}

export async function transcodeQuotedMedia(msg, mode, { logger, maxBytes = 95 * 1024 * 1024 } = {}) {
  const source = target(msg)
  const kind = kindOf(source.message)
  if (!kind) throw new Error('Responda a uma imagem, vídeo, áudio ou figurinha.')
  const buffer = await downloadMediaMessage(source, 'buffer', {}, { logger })
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Não consegui baixar a mídia.')
  if (buffer.length > maxBytes) throw new Error(`A mídia ultrapassa o limite de ${Math.floor(maxBytes/1024/1024)} MB.`)
  await ensureTemp()
  const id=randomUUID(), input=path.join(settings.tmpDir,`${id}${extFor(kind)}`)
  const output=path.join(settings.tmpDir,`${id}.${mode==='audio'?'ogg':mode==='mp3'?'mp3':'mp4'}`)
  await fs.writeFile(input,buffer)
  try {
    const args=['-hide_banner','-loglevel','error','-y','-i',input]
    if(mode==='audio')args.push('-vn','-c:a','libopus','-b:a','128k',output)
    else if(mode==='mp3')args.push('-vn','-c:a','libmp3lame','-b:a','192k',output)
    else if(mode==='gif')args.push('-t','12','-vf','fps=18,scale=720:-2:force_original_aspect_ratio=decrease','-an','-c:v','libx264','-pix_fmt','yuv420p',output)
    else args.push('-t','30','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',output)
    await runProcess(settings.ffmpegPath,args,{timeoutMs:90000,logger})
    const out=await fs.readFile(output)
    if(out.length>maxBytes)throw new Error(`A conversão ultrapassou o limite de ${Math.floor(maxBytes/1024/1024)} MB.`)
    return { buffer: out, mode, sourceKind: kind }
  } finally {
    await Promise.all([input,output].map(file=>fs.rm(file,{force:true}).catch(()=>{})))
  }
}
