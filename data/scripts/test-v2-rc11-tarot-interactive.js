import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TAROT_MODES,
  parseTarotRequest,
  buildTarotBaseText,
  buildTarotAiPrompt,
  drawTarotCards,
  createPendingTarotReading,
  getPendingTarotReading,
  consumeTarotQuota
} from '../tarot.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

assert.ok(TAROT_MODES.simnao, 'modo sim/não deve existir')
assert.ok(TAROT_MODES.amor, 'modo amor deve existir')
assert.ok(TAROT_MODES.trabalho, 'modo trabalho deve existir')
assert.ok(TAROT_MODES.conselho, 'modo conselho deve existir')

assert.deepEqual(parseTarotRequest('simnao vou conseguir?'), { mode: 'simnao', question: 'vou conseguir?' })
assert.deepEqual(parseTarotRequest('sim ou nao vou conseguir?'), { mode: 'simnao', question: 'vou conseguir?' })
assert.deepEqual(parseTarotRequest('amor ele gosta de mim?'), { mode: 'amor', question: 'ele gosta de mim?' })
assert.deepEqual(parseTarotRequest('minha vida vai melhorar?'), { mode: 'geral', question: 'minha vida vai melhorar?' })

const cards = drawTarotCards(() => 0.314159)
const base = buildTarotBaseText('vou conseguir?', cards, { mode: 'simnao' })
assert.match(base, /Pergunta:/)
assert.match(base, /Sim|Não|Talvez|tendência/i)
assert.match(base, /Passado|Sinal|Caminho/i)
const aiPrompt = buildTarotAiPrompt('vou conseguir?', cards, { mode: 'simnao' })
assert.match(aiPrompt, /sim|não|talvez/i)

const reading = await createPendingTarotReading({
  chatJid: '120363000000000@g.us',
  senderNumber: '5511999999999',
  question: 'vou conseguir?',
  mode: 'simnao',
  cards,
  now: 1_700_000_000_000
})
assert.ok(reading.id && reading.id.length <= 24, 'id da leitura precisa caber no botão')
assert.equal((await getPendingTarotReading(reading.id, { senderNumber: '5511999999999', chatJid: '120363000000000@g.us', now: 1_700_000_000_500 }))?.question, 'vou conseguir?')
assert.equal(await getPendingTarotReading(reading.id, { senderNumber: '5511888888888', chatJid: '120363000000000@g.us', now: 1_700_000_000_500 }), null, 'outro usuário não pode abrir a interpretação')

const normal = await consumeTarotQuota('5511777777777', { vip: false, limit: 10, now: Date.UTC(2026, 7, 28, 12) })
assert.equal(normal.allowed, true)
assert.equal(normal.limit, 10)
assert.equal(normal.remaining, 9)
const vip = await consumeTarotQuota('5511666666666', { vip: true, limit: 10, now: Date.UTC(2026, 7, 28, 12) })
assert.equal(vip.allowed, true)
assert.equal(vip.unlimited, true)

const source = fs.readFileSync(path.join(root, 'commands/tarot.js'), 'utf8')
assert.match(source, /sendQuickButtons/)
assert.match(source, /⭐ Ver interpretação/)
assert.match(source, /interpretar/)
assert.match(source, /consumeTarotQuota/)
assert.match(source, /isVip/)
assert.doesNotMatch(source, /await sock\.sendMessage\(msg\.key\.remoteJid,\{ image \}/, 'imagem não pode mais sair separada do texto')

const template = fs.readFileSync(path.join(root, 'assets/tarot/template.png'))
assert.ok(template.length > 4000, 'template estrelado precisa existir')
console.log('Tarô interativo/limites RC11: OK')
