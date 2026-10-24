import assert from 'node:assert/strict'
import playCommand, { buildPlayCaption, formatDuration } from '../../commands/play.js'
import { summarizeMusicTitle } from '../music-title.js'
import { mapYtDlpInfo } from '../player/yt-dlp-engine.js'

assert.equal(playCommand.name, 'play')
for (const alias of ['musica', 'tocar', 'music', 'song', 'mp3']) assert.ok(playCommand.aliases.includes(alias))
assert.match(playCommand.usage, /nome da música|YouTube/i)
assert.match(playCommand.description, /yt-dlp/i)
assert.match(playCommand.description, /fila|cache/i)
assert.doesNotMatch(playCommand.description, /Nexia|SDK/i)

assert.equal(formatDuration(190), '3:10')
assert.equal(formatDuration(3723), '1:02:03')
assert.equal(summarizeMusicTitle('Eminem - Lose Yourself (Official Video) [4K]', 'Eminem'), 'Lose Yourself')
assert.equal(summarizeMusicTitle('Lady Gaga - Abracadabra (Official Music Video)', 'Lady Gaga'), 'Abracadabra')

const caption = buildPlayCaption({
  title: 'Eminem - Lose Yourself (Official Video) [4K]',
  durationSeconds: 326,
  author: 'EminemMusic',
  likeCount: 1234567
})
const normalizedCaption = caption.replace(/\n▢\s*/g, ' ').replace(/\s+/g, ' ')
assert.match(normalizedCaption, /Lose Yourself/)
assert.doesNotMatch(caption, /Eminem -|Official Video|4K|duração:|motor:|status:/i)
assert.match(normalizedCaption, /autor:\*? EminemMusic/i)
assert.match(normalizedCaption, /likes:\*? 1\.234\.567/i)

const mapped = mapYtDlpInfo({
  id: 'abc123',
  title: 'Teste',
  uploader: 'Canal Teste',
  like_count: 987654
})
assert.equal(mapped.author, 'Canal Teste')
assert.equal(mapped.likeCount, 987654)
assert.match(caption, /PLAYER SAKURA/)
assert.doesNotMatch(caption, /Nexia|api\/musica|api\/ytmp3/i)

console.log('✅ Card Sakura do play: título curto e pipeline gerenciado aprovados')
