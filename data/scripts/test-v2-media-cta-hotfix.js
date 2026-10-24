import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearCommandOfficialLinks, commandOfficialLinksAllowed, setCommandOfficialLinks } from '../command-ui-state.js'
import { sendStickerMedia } from '../media-delivery.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

// RED: qualquer mídia sensível enviada pelo helper deve impedir CTA oficial no restante do comando.
const msg = { key: { id: 'hotfix-media-cta', remoteJid: '123@g.us' } }
setCommandOfficialLinks(msg, true)
const sent = []
const sock = { sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'm1' } } } }
await sendStickerMedia(sock, msg, Buffer.from('webp'))
assert.equal(sent.length, 1)
assert.equal(commandOfficialLinksAllowed(msg), false, 'envio de mídia precisa bloquear CTA oficial até o fim do comando')
clearCommandOfficialLinks(msg)

// O ban deve usar os helpers de mídia, evitando o sendMessage cru que deixava o handler anexar botões.
const admin = read('commands/admin.js')
assert.match(admin, /sendAudioMedia/)
assert.match(admin, /sendStickerMedia/)
assert.doesNotMatch(admin, /dispatches\.push\(sock\.sendMessage\(msg\.key\.remoteJid,\s*\{\s*audio:/s)
assert.doesNotMatch(admin, /dispatches\.push\(sock\.sendMessage\(msg\.key\.remoteJid,\s*\{\s*sticker:/s)
assert.match(admin, /participantAction\(sock, msg, args, 'remove', \{ replyDone: false \}\)/, 'ban não pode enviar confirmação textual após remover')
assert.doesNotMatch(admin, /foi removid[oa] do grupo|pessoa removida/i, 'ban não deve enviar texto de usuário removido')

// Outros fluxos compartilhados com mídia também devem desligar CTA automaticamente.
assert.match(read('data/social-actions.js'), /suppressCommandOfficialLinks\(msg\)/)
assert.match(read('data/fun-media-store.js'), /suppressCommandOfficialLinks\(msg\)/)
assert.match(read('commands/action-media.js'), /suppressCommandOfficialLinks\(msg\)/)
assert.match(read('commands/figvip.js'), /sendStickerMedia/)
assert.match(read('commands/group-status.js'), /officialLinks:\s*false/, 'status com imagem/vídeo não deve anexar barra oficial')

console.log('✅ hotfix: mídia de ban/ações/figurinhas não recebe botões oficiais')
