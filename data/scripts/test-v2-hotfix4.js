import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendAudioMedia, sendStickerMedia } from '../media-delivery.js'
import { reply } from '../reply.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const msg = { key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'HOTFIX4' }, pushName: 'Teste', message: { conversation: 'teste' } }

function fakeSocket() {
  const calls = []
  return {
    calls,
    user: { id: '5581000000000@s.whatsapp.net' },
    async sendMessage(jid, content, options = {}) {
      calls.push({ jid, content, options })
      return { key: { id: String(calls.length) } }
    }
  }
}

// Regra global para comandos com mais de uma saída: a saída secundária pode
// ser enviada sem citar de novo o trigger original.
{
  const sock = fakeSocket()
  await sendAudioMedia(sock, msg, Buffer.from('audio'), { quoted: false })
  assert.equal('quoted' in sock.calls[0].options, false, 'áudio secundário não pode repetir reply no trigger')
}
{
  const sock = fakeSocket()
  await sendStickerMedia(sock, msg, Buffer.from('sticker'), { quoted: false })
  assert.equal('quoted' in sock.calls[0].options, false, 'figurinha secundária não pode repetir reply no trigger')
}
{
  const sock = fakeSocket()
  await reply(sock, msg, 'segunda mensagem', { quoted: false, raw: true })
  assert.equal('quoted' in sock.calls[0].options, false, 'reply secundário precisa suportar envio sem citação')
}

// Contratos específicos pedidos para menu/ban/play e gatilhos combinados.
const menu = source('commands/menu.js')
assert.match(menu, /playMenuAudio[\s\S]*quoted:\s*false/, 'áudio do .menu precisa ficar abaixo sem reply')

const admin = source('commands/admin.js')
assert.match(admin, /dispatchMode:\s*['"]ordered-audio-sticker['"]/, '.ban precisa enviar áudio antes da figurinha')
assert.match(admin, /sendStickerMedia\([^)]*\{[^}]*quoted:\s*false/s, 'figurinha do .ban precisa ser secundária e sem reply')
assert.doesNotMatch(admin, /foi removido do grupo/i, '.ban não deve confirmar remoção por texto')

const play = source('commands/play.js')
assert.match(play, /fs\.readFile\(media\.filePath\)/, '.play precisa materializar o áudio em Buffer antes da limpeza do arquivo temporário')
assert.match(play, /sendAudioMedia\([\s\S]*quoted:\s*false/, 'áudio do .play precisa ficar abaixo do card sem repetir reply')

const handler = source('data/handler.js')
assert.match(handler, /effectiveCombined\s*\?\s*\{\}\s*:\s*\{\s*quoted:\s*msg\s*\}/, 'segunda mídia de gatilho combinado deve ficar sem reply')

// Se a IA for chamada e não houver token utilizável, o engine deve ter aviso explícito.
const aiEngine = source('data/ai-engine.js')
assert.match(aiEngine, /notifyAiUnavailable/, 'engine precisa avisar falta de token em chamadas da IA')
assert.match(aiEngine, /SEM TOKENS|sem token/i, 'aviso de falta de token precisa ser claro')

// Tokens antigos inválidos (ex.: URL salva por build anterior) não podem ser tratados como token Groq.
assert.ok(fs.existsSync(path.join(root, 'data/ai-token-utils.js')), 'validador central de token IA ausente')
const tokenUtils = await import(`../ai-token-utils.js?t=${Date.now()}`)
assert.equal(tokenUtils.isPlausibleAiToken('https://vt.tiktok.com/ZSVxxxx/'), false)
assert.equal(tokenUtils.isPlausibleAiToken('gsk_' + 'a'.repeat(40)), true)


assert.ok(fs.existsSync(path.join(root, 'data/ai-provider-utils.js')), 'normalizador do endpoint Groq ausente')
const providerUtils = await import(`../ai-provider-utils.js?t=${Date.now()}`)
assert.equal(providerUtils.normalizeGroqBaseUrl('https://api.groq.com/openai/v1/chat/completions'), 'https://api.groq.com/openai/v1')
assert.equal(providerUtils.normalizeGroqBaseUrl('https://api.groq.com/v1'), 'https://api.groq.com/openai/v1')

// 404 de endpoint/modelo não deve virar retry silencioso; precisa de política terminal/diagnóstica.
assert.ok(fs.existsSync(path.join(root, 'data/ai-failure-policy.js')), 'política de falhas da IA ausente')
const failurePolicy = await import(`../ai-failure-policy.js?t=${Date.now()}`)
assert.equal(failurePolicy.aiFailurePolicy(404).retryLater, false)
assert.equal(failurePolicy.aiFailurePolicy(404).rotateToken, false)
assert.equal(failurePolicy.aiFailurePolicy(429).rotateToken, true)

console.log('✅ Hotfix4: reply primário/secundário, ban, menu, play e IA aprovados')
