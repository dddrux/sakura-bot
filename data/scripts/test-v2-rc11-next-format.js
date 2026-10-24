import assert from 'node:assert/strict'
import { formatMessage, wrapSakuraLine } from '../formatter.js'
import { formatRankingBody } from '../ranking-format.js'

assert.deepEqual(
  wrapSakuraLine('tempo de uso: um dois tres quatro'),
  ['tempo de uso: um dois tres quatro'],
  'o formatador deve aceitar 7 palavras contando as anteriores a :'
)
assert.deepEqual(
  wrapSakuraLine('tempo de uso: um dois tres quatro cinco'),
  ['tempo de uso: um dois', 'tres quatro cinco'],
  'a oitava palavra não deve virar uma linha órfã'
)
const long = formatMessage('Correção provável: .autoia — digite exatamente assim para confirmar.', { title: 'COMANDO INVÁLIDO' })
assert.match(long, /^▢   ↳ /m, 'continuação deve ter recuo visual')
assert.doesNotMatch(long, /^▢ (?:assim|para|confirmar\.?)(?:\s|$)/m, 'não pode sobrar linha curta sem recuo')

const rank = formatRankingBody([
  { name: '@um', label: '100%' }, { name: '@dois', label: '90%' }, { name: '@tres', label: '80%' },
  { name: '@quatro', label: '70%' }, { name: '@cinco', label: '60%' }
], { title: 'RANK GAY' })
assert.match(rank, /^🌸 4º @quatro$/m)
assert.match(rank, /^🌸 5º @cinco$/m)
assert.doesNotMatch(rank, /^▢\s+🌸\s+4º$/m)
console.log('✅ formatter/ranking RC11 next')
