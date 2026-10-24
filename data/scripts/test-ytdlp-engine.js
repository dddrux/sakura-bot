import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import {
  buildYtDlpArgs,
  downloadWithYtDlp,
  classifyYtDlpError,
  installYtDlp,
  mapYtDlpInfo,
  resolveYtDlpReleaseAsset
} from '../player/yt-dlp-engine.js'

assert.deepEqual(resolveYtDlpReleaseAsset('linux', 'x64'), { asset: 'yt-dlp_linux', fileName: 'yt-dlp' })

const installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-ytdlp-test-'))
const targetPath = path.join(installDir, 'yt-dlp')
const fakeBinary = Buffer.from('#!/bin/sh\necho 2026.test\n')
const checksum = createHash('sha256').update(fakeBinary).digest('hex')
const fetchImpl = async url => {
  const body = String(url).endsWith('SHA2-256SUMS')
    ? Buffer.from(`${checksum}  yt-dlp_linux\n`)
    : fakeBinary
  return {
    ok: true,
    status: 200,
    headers: { get: name => String(name).toLowerCase() === 'content-length' ? String(body.length) : null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  }
}
await installYtDlp({ targetPath, platform: 'linux', arch: 'x64', fetchImpl })
assert.equal(await fs.readFile(targetPath, 'utf8'), fakeBinary.toString('utf8'))
await fs.rm(installDir, { recursive: true, force: true })

if (process.platform !== 'win32') {
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-ytdlp-runtime-'))
  const fakeBinaryPath = path.join(fakeDir, 'yt-dlp')
  const fakeScript = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2026.fake"; exit 0; fi
OUT=""
INFO=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    case "$1" in
      infojson:*) INFO="\${1#infojson:}" ;;
      *) OUT="$1" ;;
    esac
  fi
  shift
done
FILE=$(printf '%s' "$OUT" | sed 's/%(ext)s/mp3/g')
mkdir -p "$(dirname "$FILE")"
dd if=/dev/zero of="$FILE" bs=2048 count=20 2>/dev/null
printf '%s' '{"id":"fakevideo01","title":"Headlock","artist":"Imogen Heap","duration":236,"upload_date":"20051010","webpage_url":"https://www.youtube.com/watch?v=fakevideo01"}' > "$INFO"
printf '%s\n' "$FILE"
exit 0
`
  await fs.writeFile(fakeBinaryPath, fakeScript, { mode: 0o755 })
  await fs.chmod(fakeBinaryPath, 0o755)
  process.env.YTDLP_PATH = fakeBinaryPath
  const outputBase = path.join(fakeDir, 'audio-test')
  const downloaded = await downloadWithYtDlp({
    videoUrl: 'https://www.youtube.com/watch?v=fakevideo01',
    outputBase,
    cookieFile: '',
    fallback: { title: 'Headlock' }
  })
  assert.equal(downloaded.title, 'Headlock')
  assert.equal(downloaded.author, 'Imogen Heap')
  assert.equal(downloaded.client, 'yt-dlp')
  assert.ok(downloaded.outputBytes >= 2048)
  delete process.env.YTDLP_PATH
  await fs.rm(fakeDir, { recursive: true, force: true })
}

assert.deepEqual(resolveYtDlpReleaseAsset('linux', 'arm64'), { asset: 'yt-dlp_linux_aarch64', fileName: 'yt-dlp' })
assert.equal(resolveYtDlpReleaseAsset('freebsd', 'x64'), null)

const base = path.join('/tmp', 'sakura-player-test')
const args = buildYtDlpArgs({
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  outputBase: base,
  ffmpegPath: '/usr/bin/ffmpeg'
})
assert.ok(args.includes('--js-runtimes'))
assert.ok(args.some(value => value.startsWith('node:')))
assert.ok(args.includes('--ffmpeg-location'))
assert.ok(args.includes('/usr/bin/ffmpeg'))
assert.ok(!args.includes('--extract-audio'))
assert.ok(!args.includes('--remote-components'))
assert.ok(!args.includes('ejs:github'))
assert.ok(args.includes('--no-part'))
assert.ok(args.includes('--abort-on-unavailable-fragments'))
assert.ok(args.includes('after_move:filepath'))
assert.ok(!args.includes('--cookies'))
assert.ok(args.includes('--no-playlist'))
const searchArgs = buildYtDlpArgs({ url: 'ytsearch5:Headlock Imogen Heap', outputBase: base })
assert.ok(searchArgs.includes('--playlist-end'))
assert.ok(!searchArgs.includes('--no-playlist'))


const safariArgs = buildYtDlpArgs({
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  outputBase: base,
  formatMode: 'safari-m4a',
  playerClients: 'web_safari'
})
assert.ok(safariArgs.includes('--extract-audio'))
assert.ok(safariArgs.includes('m4a'))
assert.ok(safariArgs.includes('--hls-prefer-native'))
assert.ok(safariArgs.some(value => String(value).includes('youtube:player_client=web_safari')))
assert.ok(!safariArgs.includes('--cookies'))

const cookieArgs = buildYtDlpArgs({
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  outputBase: base,
  cookieFile: '/tmp/cookies.txt',
  useCookies: true
})
assert.ok(cookieArgs.includes('--cookies'))
assert.ok(cookieArgs.includes('/tmp/cookies.txt'))

const mapped = mapYtDlpInfo({
  id: 'dQw4w9WgXcQ',
  title: 'Faixa de teste',
  artist: 'Artista',
  duration: 213,
  view_count: 1234,
  upload_date: '20260724',
  webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
})
assert.equal(mapped.title, 'Faixa de teste')
assert.equal(mapped.author, 'Artista')
assert.equal(mapped.durationSeconds, 213)
assert.equal(mapped.uploadDate, '2026-07-24')
assert.equal(mapped.client, 'yt-dlp')

assert.equal(classifyYtDlpError(new Error('Sign in to confirm you’re not a bot')).errorType, 'YTDLP_LOGIN_REQUIRED')
assert.equal(classifyYtDlpError(new Error('HTTP Error 403: Forbidden')).status, 403)
assert.equal(classifyYtDlpError(new Error('This video is unavailable')).errorType, 'VIDEO_UNAVAILABLE')

console.log('✅ Player yt-dlp anônimo: clientes públicos, HLS, proxy, formatos e erros aprovados')
