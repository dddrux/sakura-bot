import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { wrapSakuraLine } from '../formatter.js'
import { formatRankingBody } from '../ranking-format.js'
import * as stickerMeta from '../sticker-metadata.js'
import * as aiEngine from '../ai-engine.js'
import { sendSelectableCommandMenu } from '../interactive.js'
import { loadCommands } from '../handler.js'

assert.deepEqual(
  wrapSakuraLine('tempo de uso: um dois tres quatro'),
  ['tempo de uso: um dois tres quatro'],
  'o formatador deve aceitar 7 palavras contando as anteriores a :'
)
assert.deepEqual(
  wrapSakuraLine('tempo de uso: um dois tres quatro cinco'),
  ['tempo de uso: um dois tres quatro', 'cinco'],
  'a oitava palavra deve iniciar uma nova linha'
)

const rank = formatRankingBody([
  { name: '@um', label: '100%' },
  { name: '@dois', label: '90%' },
  { name: '@tres', label: '80%' },
  { name: '@quatro', label: '70%' },
  { name: '@cinco', label: '60%' }
], { title: 'RANK GAY' })
assert.match(rank, /^🌸 4º @quatro$/m, '4º colocado precisa ficar inteiro na mesma linha')
assert.match(rank, /^🌸 5º @cinco$/m, '5º colocado precisa ficar inteiro na mesma linha')
assert.doesNotMatch(rank, /^▢\s+🌸\s+4º$/m, 'ranking não pode separar marcador do nome')

assert.equal(typeof stickerMeta.addExactStickerMetadata, 'function', 'falta metadata exata para .take/autofig')
assert.equal(typeof aiEngine.formatAiReply, 'function', 'falta apresentação crua da IA')
assert.equal(aiEngine.formatAiReply('Olá!'), 'Olá!\n\nˢᵃᵏᵘʳᵃ • ᵐᵉⁿˢᵃᵍᵉᵐ ᵍᵉʳᵃᵈᵃ ᵖᵒʳ ᴵᴬ')

await fs.access(new URL('../brat-quota.js', import.meta.url))
await fs.access(new URL('../pinterest-search.js', import.meta.url))
const quota = await import('../brat-quota.js')
assert.equal(typeof quota.consumeBratQuota, 'function')
const pin = await import('../pinterest-search.js')
assert.equal(typeof pin.parsePinterestSearchPayload, 'function')

const fakePayload = {
  resource_response: {
    status: 'success',
    bookmark: 'NEXT',
    data: {
      results: [
        { id: '1', images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c/one.jpg', width: 1000, height: 1200 } } },
        { id: '2', images: { '736x': { url: 'https://i.pinimg.com/736x/a/b/c/two.jpg', width: 736, height: 900 } } }
      ]
    }
  }
}
const parsedPins = pin.parsePinterestSearchPayload(fakePayload)
assert.equal(parsedPins.images.length, 2)
assert.equal(parsedPins.bookmark, 'NEXT')

const commands = await loadCommands(new Proxy({}, { get: () => () => {} }))
const relays = []
const sock = {
  user: { id: '5581999999999@s.whatsapp.net' },
  waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/menu.jpg', directPath: '/menu.jpg' }),
  async relayMessage(jid, message, options) {
    relays.push({ jid, message, options })
    return options.messageId
  }
}
await sendSelectableCommandMenu({
  sock,
  msg: { key: { remoteJid: '120363000000000000@g.us', participant: '5581888888888@s.whatsapp.net', id: 'MENU-REQ' } },
  commands,
  logger: new Proxy({}, { get: () => () => {} }),
  requesterNumber: '5581888888888'
})
const menuMessage = relays.at(-1)?.message?.viewOnceMessage?.message?.interactiveMessage
const button = menuMessage?.nativeFlowMessage?.buttons?.find(item => item.name === 'single_select')
const sections = JSON.parse(button?.buttonParamsJson || '{}').sections || []
const profileRow = sections.flatMap(section => section.rows || []).find(row => String(row.title || '').includes('Meu perfil'))
assert.equal(profileRow?.id, '.perfil 5581888888888', 'Meu perfil deve carregar quem abriu o menu')

console.log('✅ RC11 next: formatter 7 palavras, ranking, IA raw, metadata exata, quota, Pinterest e perfil solicitante especificados')
