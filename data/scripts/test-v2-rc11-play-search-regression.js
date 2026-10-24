import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

if (process.platform === 'win32') {
  console.log('✅ regressão do search do play ignorada no Windows neste teste de shell')
  process.exit(0)
}

const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-play-search-regression-'))
const fakeBinaryPath = path.join(fakeDir, 'yt-dlp')
const filler = 'x'.repeat(180_000)
const payload = JSON.stringify({
  _type: 'playlist',
  id: 'Headlock Imogen Heap',
  entries: [{
    id: 'headlock123',
    title: 'Imogen Heap - Headlock (Official Video)',
    artist: 'Imogen Heap',
    uploader: 'Imogen Heap',
    duration: 236,
    like_count: 456789,
    webpage_url: 'https://www.youtube.com/watch?v=headlock123',
    thumbnail: 'https://i.ytimg.com/vi/headlock123/hqdefault.jpg',
    description: filler
  }]
})
const compact = JSON.stringify({
  id: 'headlock123',
  title: 'Imogen Heap - Headlock (Official Video)',
  artist: 'Imogen Heap',
  uploader: 'Imogen Heap',
  duration: 236,
  like_count: 456789,
  webpage_url: 'https://www.youtube.com/watch?v=headlock123',
  thumbnail: 'https://i.ytimg.com/vi/headlock123/hqdefault.jpg'
})

const script = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2026.fake"; exit 0; fi
for arg in "$@"; do
  if [ "$arg" = "--print" ]; then
    printf '%s\n' '${compact}'
    exit 0
  fi
done
cat <<'JSON'
${payload}
JSON
`
await fs.writeFile(fakeBinaryPath, script, { mode: 0o755 })
await fs.chmod(fakeBinaryPath, 0o755)
process.env.YTDLP_PATH = fakeBinaryPath
process.env.SAKURA_AUTO_INSTALL_YTDLP = 'false'

try {
  const { resolveYtDlpMedia } = await import(`../player/yt-dlp-engine.js?regression=${Date.now()}`)
  const result = await resolveYtDlpMedia('Headlock Imogen Heap', { deadline: Date.now() + 10_000 })
  assert.equal(result.videoId, 'headlock123')
  assert.equal(result.author, 'Imogen Heap')
  assert.equal(result.likeCount, 456789)
  console.log('✅ busca do .play usa metadados compactos e não perde resultados grandes do yt-dlp')
} finally {
  delete process.env.YTDLP_PATH
  delete process.env.SAKURA_AUTO_INSTALL_YTDLP
  await fs.rm(fakeDir, { recursive: true, force: true })
}
