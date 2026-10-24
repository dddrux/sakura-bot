import fs from 'node:fs/promises'
import path from 'node:path'
import { convertToSticker } from '../media.js'
import { settings } from '../settings.js'

const input = await fs.readFile(path.join(settings.menuImageDir, 'sakura-logo.png'))
const output = await convertToSticker(input, 'image')
if (output.subarray(0, 4).toString() !== 'RIFF' || output.subarray(8, 12).toString() !== 'WEBP') throw new Error('conversão .s inválida')
console.log(`✅ .s local: imagem convertida para WebP 512x512 | ${output.length} bytes`)
