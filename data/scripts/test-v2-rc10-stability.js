import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig, writeConfigSync, isConfiguredOwner } from '../settings.js'
import { resolveTargetIdentityNumber } from '../target-resolution.js'
import { downloadStrategyForUrl } from '../auto-download.js'
import { appendFfmpegLocation } from '../player/yt-dlp-engine.js'
import { renderBratWithFfmpeg } from '../brat-ffmpeg.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')

// 1) LID mencionado deve virar PN real antes de salvar dono.
const fakeSock = {
  sakuraResolveNumber: async jid => String(jid).includes('48748197621848') ? '558199434137' : ''
}
assert.equal(await resolveTargetIdentityNumber(fakeSock, '120363000000000000@g.us', ['48748197621848@lid']), '558199434137')

// 2) isConfiguredOwner precisa enxergar alteração do config em runtime.
const original = readConfig()
try {
  const probe = '551199998877'
  writeConfigSync({ owners: [...original.owners, { name: 'Runtime', number: probe, role: 'owner', enabled: true }] })
  assert.equal(isConfiguredOwner(probe), true)
} finally {
  writeConfigSync({ owners: original.owners })
}

// 3) regressões observadas em produção.
assert.match(source('commands/autoia.js'), /async execute\(\{[^}]*logger[^}]*\}\)/s, 'autoia precisa receber logger')
assert.match(source('data/triggers.js'), /import\s+\{[^}]*addExactStickerMetadata[^}]*\}\s+from\s+['"]\.\/sticker-metadata\.js['"]/, 'triggers precisa importar metadata exata')

// 4) AutoDownload deve tratar TikTok com downloader dedicado enquanto o extractor upstream está quebrado.
assert.equal(downloadStrategyForUrl('https://www.tiktok.com/@x/video/7677710902690401557'), 'tiktok')
assert.equal(downloadStrategyForUrl('https://example.com/video.mp4'), 'generic')

// 5) ffmpeg no PATH não deve gerar --ffmpeg-location ffmpeg inválido.
const args = []
appendFfmpegLocation(args, 'ffmpeg')
assert.equal(args.includes('--ffmpeg-location'), false)

// 6) Brat deve funcionar só com FFmpeg, sem Sharp/ImageMagick.
const output = path.join(root, 'storage', 'temp', 'rc10-brat-test.webp')
fs.mkdirSync(path.dirname(output), { recursive: true })
await renderBratWithFfmpeg({
  text: 'ai caralho',
  lines: ['ai caralho'],
  background: '#FFFFFF',
  foreground: '#111111',
  alignment: 'left',
  output,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg'
})
const webp = fs.readFileSync(output)
assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF')
assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP')
fs.rmSync(output, { force: true })

// 7) .ia deve ter caminho explícito de conversa e ai-engine deve aceitar força/feedback.
assert.match(source('commands/ai.js'), /maybeHandleAi/, '.ia precisa despachar perguntas para a IA')
assert.match(source('data/ai-engine.js'), /force\s*=\s*false/, 'ai-engine precisa suportar chamada manual')

// 8) menuconfig pertence ao painel de configuração, não ao Bot Info.
assert.doesNotMatch(source('commands/info.js'), /aliases:\s*\[[^\]]*menuconfig/s, 'Bot Info não deve possuir menuconfig')
assert.match(source('commands/config.js'), /aliases:\s*\[[^\]]*menuconfig/s, 'Config deve possuir menuconfig')

// 9) patch de sessão precisa rodar automaticamente no prestart.

const pkg = JSON.parse(source('package.json'))
assert.match(pkg.scripts.prestart, /patch-dependencies\.js/, 'prestart precisa remover logs criptográficos do libsignal')

console.log('✅ RC10 stability regression tests passed')
