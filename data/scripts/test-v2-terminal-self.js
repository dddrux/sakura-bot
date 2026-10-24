import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '../logger.js'
import { isConnectedSelf, shouldProcessOwnMessage } from '../superuser.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stripAnsi = value => String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')

assert.equal(shouldProcessOwnMessage({ fromMe: true, text: '.baileys', prefix: '.' }), true)
assert.equal(shouldProcessOwnMessage({ fromMe: true, text: 'resposta normal da Sakura', prefix: '.' }), false)
assert.equal(shouldProcessOwnMessage({ fromMe: false, text: 'oi', prefix: '.' }), true)

const sock = { user: { id: '558193775177:4@s.whatsapp.net', lid: '3028253982746@lid' } }
assert.equal(isConnectedSelf({ sock, fromMe: true, senderNumber: '551199999999', botNumber: '558193775177' }), true)
assert.equal(isConnectedSelf({ sock, fromMe: false, senderNumber: '558193775177', botNumber: '558193775177' }), true)
assert.equal(isConnectedSelf({ sock, fromMe: false, senderNumber: '551199999999', botNumber: '558193775177' }), false)

const writes = []
const originalWrite = process.stdout.write
process.stdout.write = function patchedWrite(chunk, ...rest) {
  writes.push(String(chunk))
  return true
}
try {
  const logger = createLogger({ scope: 'MESSAGES', level: 'info', fileLevel: 'fatal' })
  logger.info({
    senderName: 'Mel',
    senderNumber: '5512996038129',
    senderJid: '18240726167667@lid',
    phoneJid: '5512996038129@s.whatsapp.net',
    lidJid: '18240726167667@lid',
    chatJid: '120363427075207027@g.us',
    isGroup: true,
    messageType: 'extendedTextMessage',
    textPreview: 'vou sair daqui com esse se quiser colocar eu com o meu outro número'
  }, 'mensagem recebida')
} finally {
  process.stdout.write = originalWrite
}

const consoleLine = stripAnsi(writes.join(''))
assert.match(consoleLine, /MSG\s+Mel\s*\(\+5512996038129\)\s*·\s*grupo\s*·/i)
assert.match(consoleLine, /vou sair daqui/i)
assert.doesNotMatch(consoleLine, /senderJid|phoneJid|lidJid|chatJid|messageType=/i)
assert.doesNotMatch(consoleLine, /18240726167667@lid|120363427075207027@g\.us/i)

const clientSource = fs.readFileSync(path.join(root, 'data/client.js'), 'utf8')
assert.doesNotMatch(clientSource, /printSakuraBanner|function\s+banner\s*\(|\bbanner\(\)/, 'cabeçalho grande ainda é chamado no boot')

const handlerSource = fs.readFileSync(path.join(root, 'data/handler.js'), 'utf8')
assert.match(handlerSource, /isConnectedSelf/, 'handler não reconhece a própria conta conectada')
assert.match(handlerSource, /shouldProcessOwnMessage/, 'handler não filtra ecos próprios com segurança')
assert.match(handlerSource, /senderIsOwnerEarly\s*=\s*senderIsSelf\s*\|\|\s*isConfiguredOwner/, 'a própria conta não recebe privilégios de dono')
assert.doesNotMatch(handlerSource, /if\s*\(msg\.key\.fromMe\)\s*\{[\s\S]{0,160}?return/, 'handler ainda descarta todos os comandos enviados pela própria conta')

console.log('✅ V2 terminal compacto + superusuário da própria conta: contratos aprovados')
