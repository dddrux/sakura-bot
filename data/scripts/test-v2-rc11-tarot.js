import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TAROT_POSITIONS, drawTarotCards, buildTarotBaseText, buildTarotAiPrompt, getTarotDeck, renderTarotImage } from '../tarot.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const deck = getTarotDeck()
assert.equal(deck.length, 78, 'o pack precisa registrar as 78 cartas')
assert.deepEqual(TAROT_POSITIONS, ['Passado', 'Presente', 'Caminho'])
assert.equal(new Set(deck.map(card => card.id)).size, 78, 'IDs devem ser únicos')
for (const card of deck) {
  assert.ok(card.name && card.meaning && card.image, `carta incompleta: ${card.id}`)
  assert.ok(fs.existsSync(path.join(root, 'assets/tarot/cards', card.image)), `imagem ausente: ${card.image}`)
  assert.ok(fs.existsSync(path.join(root, 'assets/tarot/labels', card.label)), `label ausente: ${card.label}`)
}
const draw = drawTarotCards(() => 0.123456789)
assert.equal(draw.length, 3)
assert.equal(new Set(draw.map(card => card.id)).size, 3, 'a tiragem não pode repetir carta')
const base = buildTarotBaseText('vou ficar bem?', draw)
assert.match(base, /Passado/)
assert.match(base, /Presente/)
assert.match(base, /Caminho/)
assert.match(base, /vou ficar bem\?/)
const aiPrompt = buildTarotAiPrompt('vou ficar bem?', draw)
assert.match(aiPrompt, /interpretação curta/i)
assert.match(aiPrompt, /não trate como certeza/i)
const rendered = await renderTarotImage(draw)
assert.ok(Buffer.isBuffer(rendered) && rendered.length > 10000, 'renderização visual precisa gerar PNG')
assert.equal(rendered[0], 0x89)
assert.equal(rendered.subarray(1,4).toString(), 'PNG')
const commandSource = fs.readFileSync(path.join(root, 'commands/tarot.js'), 'utf8')
assert.match(commandSource, /name:\s*'tarot'/)
assert.match(commandSource, /aliases:\s*\[[^\]]*'tarô'/s)
assert.match(commandSource, /renderTarotImage/)
assert.doesNotMatch(commandSource, /Tarô da Sakura[^'"`]*imagem/i)
console.log('Tarô visual RC11: OK')
