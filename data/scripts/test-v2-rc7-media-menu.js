import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = rel => fs.existsSync(path.join(root, rel))
const pkg = JSON.parse(read('package.json'))
const config = JSON.parse(read('config/sakura.config.json'))

assert.match(pkg.version, /^2\.0\.0-rc\.(?:7|8|9|10|11)$/)
assert.match(config.bot.release, /^2\.0\.0-rc\.(?:7|8|9|10|11)$/)

// npm start precisa conseguir preparar uma instalação limpa sem exigir npm i manual.
assert.ok(exists('data/scripts/bootstrap-deps.js'))
assert.match(pkg.scripts.prestart, /bootstrap-deps\.js/)
assert.match(read('data/scripts/bootstrap-deps.js'), /npm (?:install|ci)|spawnSync|spawn/)


assert.match(read('start.sh'), /npm start/)
assert.doesNotMatch(read('start.sh'), /install\.sh/)
const runtimeFiles = [
  ...fs.readdirSync(path.join(root, 'commands')).filter(name => name.endsWith('.js')).map(name => path.join('commands', name)),
  ...fs.readdirSync(path.join(root, 'data')).filter(name => name.endsWith('.js')).map(name => path.join('data', name))
]
for (const file of runtimeFiles) assert.doesNotMatch(read(file), /VER CANAL DA SAKURA/i, `${file} ainda injeta CTA antigo de mídia`)

// O vídeo do menu precisa carregar vídeo + áudio e continuar a 60 fps.
const menuVideo = path.join(root, config.ui.menuMedia)
const probe = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', menuVideo], { encoding: 'utf8' })
assert.equal(probe.status, 0, `ffprobe falhou: ${probe.stderr}`)
const streams = JSON.parse(probe.stdout).streams || []
const video = streams.find(stream => stream.codec_type === 'video')
const audio = streams.find(stream => stream.codec_type === 'audio')
assert.ok(video, 'mídia do menu precisa de stream de vídeo')
assert.ok(audio, 'mídia do menu precisa preservar stream de áudio')
assert.equal(video.codec_name, 'h264')
assert.equal(audio.codec_name, 'aac')
assert.equal(video.avg_frame_rate, '60/1')

// CTA oficial deve existir nos menus, mas não deve acompanhar mídia sensível.
const { officialLinkActions } = await import('../official-links.js')
const officialActions = officialLinkActions({ includeMenu: true })
assert.deepEqual(officialActions.map(action => action.text), ['🌸 Abrir categorias', '💮 Atualizações', '🔗 Grupo oficial da sakura'])
const interactive = read('data/interactive.js')
assert.match(interactive, /🌸 Abrir categorias/)

const mediaDelivery = read('data/media-delivery.js')
assert.doesNotMatch(mediaDelivery, /official-links|sendOfficialLinksBar|VER CANAL DA SAKURA/i)
assert.match(mediaDelivery, /sendStickerMedia/)
assert.match(mediaDelivery, /sendAudioFileMedia/)
assert.match(read('commands/s.js'), /sendStickerMedia/)
assert.match(read('commands/take.js'), /sendStickerMedia/)
assert.match(read('commands/play.js'), /sendAudioMedia/)
assert.match(read('commands/play.js'), /fs\.readFile\(media\.filePath\)/)
assert.match(read('commands/play.js'), /filePath/)
assert.doesNotMatch(read('commands/play.js'), /OfficialBar|VER CANAL/i)


// Comportamento real do helper de mídia: uma chamada de mídia, nenhum segundo CTA.
const { sendStickerMedia, sendAudioFileMedia } = await import('../media-delivery.js')
const sentPayloads = []
const fakeSock = { sendMessage: async (jid, content, options) => { sentPayloads.push({ jid, content, options }); return { key: { id: `m${sentPayloads.length}` } } } }
const fakeMsg = { key: { id: 'cmd-rc7', remoteJid: '123@s.whatsapp.net' } }
await sendStickerMedia(fakeSock, fakeMsg, Buffer.from('webp'))
assert.equal(sentPayloads.length, 1)
assert.ok(Buffer.isBuffer(sentPayloads[0].content.sticker))
sentPayloads.length = 0
await sendAudioFileMedia(fakeSock, fakeMsg, '/tmp/audio.m4a', { mimetype: 'audio/mp4' })
assert.equal(sentPayloads.length, 1)
assert.equal(sentPayloads[0].content.audio.url, '/tmp/audio.m4a')

// O bootstrap é testado sem rede com um npm fake: detecta ausência, instala e grava estado.
const { ensureDependencies, missingRequiredDependencies } = await import('./bootstrap-deps.js')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-rc7-deps-'))
try {
  fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { alpha: '1.0.0', '@scope/beta': '1.0.0' } }))
  fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: {} }))
  const fakeNpm = path.join(tempRoot, 'fake-npm.cjs')
  fs.writeFileSync(fakeNpm, `const fs=require('fs'),path=require('path'); for(const name of ['alpha','@scope/beta']) { const dir=path.join(process.cwd(),'node_modules',...name.split('/')); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0'})); } process.exit(0)`)
  const oldNpmExecPath = process.env.npm_execpath
  process.env.npm_execpath = fakeNpm
  fs.mkdirSync(path.join(tempRoot, 'node_modules', 'alpha'), { recursive: true }) // pasta vazia não conta como pacote instalado
  assert.deepEqual(missingRequiredDependencies(tempRoot).sort(), ['@scope/beta', 'alpha'])
  const result = ensureDependencies(tempRoot)
  assert.equal(result.installed, true)
  assert.deepEqual(missingRequiredDependencies(tempRoot), [])
  assert.ok(fs.existsSync(path.join(tempRoot, 'node_modules', '.sakura-deps.json')))
  if (oldNpmExecPath === undefined) delete process.env.npm_execpath
  else process.env.npm_execpath = oldNpmExecPath
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

// A política do workstation torna barras oficiais opt-in para qualquer comando.
const { normalizeCommandDefinition } = await import('../workstation.js')
const mediaCommand = normalizeCommandDefinition({ name: 'teste-media', category: 'Mídia', execute() {} })
const normalCommand = normalizeCommandDefinition({ name: 'teste-normal', category: 'Principal', execute() {} })
const safeMenuCommand = normalizeCommandDefinition({ name: 'teste-menu', category: 'Principal', officialLinks: true, execute() {} })
assert.equal(mediaCommand.officialLinks, false)
assert.equal(normalCommand.officialLinks, false)
assert.equal(safeMenuCommand.officialLinks, true)
const handler = read('data/handler.js')
assert.doesNotMatch(handler, /sendOfficialLinksBar/)

// O catálogo completo é compacto: lista todos os nomes, sem descrição por linha.
assert.doesNotMatch(interactive, /`▢ • \$\{emoji\} \*\$\{settings\.prefix\}\$\{command\.name\}\* - \$\{description\}`/)
assert.match(interactive, /`▢ • \$\{emoji\} \*\$\{settings\.prefix\}\$\{command\.name\}\*`/)

console.log('✅ RC7: menu com áudio, mídia sem CTA, catálogo compacto e npm start autônomo')
