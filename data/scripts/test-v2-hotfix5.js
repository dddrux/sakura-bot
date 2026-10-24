import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlayCaption } from '../../commands/play.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const caption = buildPlayCaption({
  title: 'Lady Gaga - Abracadabra (Official Music Video) [4K] Lyrics',
  author: 'Lady Gaga',
  likeCount: 2400000,
  durationSeconds: 225
})
assert.match(caption, /Abracadabra/i, 'card precisa manter o título musical')
assert.doesNotMatch(caption, /Official Music Video|Lyrics|4K/i, 'card não pode mostrar lixo do título do YouTube')
assert.match(caption, /autor:/i, 'card do play deve mostrar o autor')
assert.match(caption, /likes:/i, 'card do play deve mostrar likes')
assert.doesNotMatch(caption, /motor:|status:/i, 'card do play deve continuar compacto')

const playSource = source('commands/play.js')
assert.match(playSource, /playManager|PlayManager|getPlayManager/i, '.play precisa usar o gerenciador dedicado')
assert.match(playSource, /sendPreview[\s\S]*await[\s\S]*download|resolve[\s\S]*sendPreview[\s\S]*download/i, 'preview precisa acontecer antes do download do áudio')

assert.ok(fs.existsSync(path.join(root, 'data/play-manager.js')), 'gerenciador dedicado do .play ausente')
const managerSource = source('data/play-manager.js')
assert.match(managerSource, /inflight/i, 'manager precisa deduplicar downloads simultâneos')
assert.match(managerSource, /cache/i, 'manager precisa possuir cache')

const musicSource = source('data/music.js')
assert.match(musicSource, /resolveMusic|searchMusic/i, 'pipeline precisa separar busca/resolução do download')
assert.match(musicSource, /downloadResolved/i, 'pipeline precisa baixar o URL já resolvido')

const aiClient = source('data/ai-client.js')
assert.match(aiClient, /listGroqModels|resolveGroqModel/i, 'cliente Groq precisa consultar modelos disponíveis')
const aiEngine = source('data/ai-engine.js')
assert.match(aiEngine, /model-fallback|fallbackModel|resolveGroqModel/i, 'engine precisa recuperar modelo inválido automaticamente')


const aiModule = await import(`../ai-client.js?t=${Date.now()}`)
aiModule.setAiFetchImplementationForTests(async url => {
  if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [
    { id: 'llama-3.1-8b-instant' },
    { id: 'openai/gpt-oss-20b' },
    { id: 'whisper-large-v3' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  throw new Error(`URL inesperada no teste: ${url}`)
})
const fallback = await aiModule.resolveGroqModel('gsk_' + 'x'.repeat(40), 'modelo-que-nao-existe', {
  preferred: ['llama-3.1-8b-instant'],
  forceRefresh: true
})
assert.equal(fallback.model, 'llama-3.1-8b-instant', 'IA deve escolher um modelo realmente retornado pela Groq')
const alternate = await aiModule.resolveGroqModel('gsk_' + 'x'.repeat(40), '', {
  preferred: ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
  exclude: ['llama-3.1-8b-instant']
})
assert.equal(alternate.model, 'openai/gpt-oss-20b', 'fallback deve conseguir excluir o modelo que acabou de falhar')
aiModule.setAiFetchImplementationForTests()

const interactive = source('data/interactive.js')
assert.doesNotMatch(interactive, /VIP:\*?\s*toque em \*?Adquira seu VIP/i, 'frase VIP redundante deve sair do menu')

console.log('✅ Hotfix5: play gerenciado, título curto, IA resiliente e menu limpo aprovados')
