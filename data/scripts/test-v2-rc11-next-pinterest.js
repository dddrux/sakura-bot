import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { parsePinterestSearchPayload, normalizePinterestImageUrl } from '../pinterest-search.js'

const payload = {
  resource_response: {
    data: {
      results: [
        { id: '1', title: 'Gojo', images: { orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc/test.jpg', width: 1000, height: 1400 } } },
        { id: '2', grid_title: 'Gojo 2', images: { '736x': { url: 'https://i.pinimg.com/736x/dd/ee/ff/test2.jpg', width: 736, height: 1000 } } },
        { id: '3', images: { orig: { url: 'https://evil.example/image.jpg' } } }
      ]
    },
    bookmark: 'next-page'
  }
}
const parsed = parsePinterestSearchPayload(payload)
assert.equal(parsed.images.length, 2)
assert.equal(parsed.images[0].url, 'https://i.pinimg.com/originals/aa/bb/cc/test.jpg')
assert.equal(parsed.bookmark, 'next-page')
assert.equal(normalizePinterestImageUrl('https:\\/\\/i.pinimg.com\\/736x\\/a.jpg'), 'https://i.pinimg.com/736x/a.jpg')
assert.equal(normalizePinterestImageUrl('https://example.com/a.jpg'), '')

const command = await fs.readFile(new URL('../../commands/pinterest.js', import.meta.url), 'utf8')
assert.match(command, /name:\s*['\"]pin['\"]/)
assert.match(command, /aliases:\s*\[[^\]]*['\"]pinfig['\"]/s)
assert.match(command, /vipOnly:\s*true/)
assert.match(command, /const desired = 50/)
assert.match(command, /sent >= 5/)
assert.match(command, /limit:\s*70/)
assert.match(command, /limit:\s*12/)
assert.match(command, /convertToSticker/)
console.log('✅ Pinterest sem token: parser + .pin + .pinfig VIP')
