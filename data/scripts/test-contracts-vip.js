import assert from 'node:assert/strict'
import { getRental, hasActiveRental, removeRental, setRental } from '../rentals.js'
import { getVip, isVip, removeVip, setVip, vipBenefits } from '../vip.js'
import { buildMenuHeader } from '../interactive.js'

const group = '120363999999999999@g.us'
const number = '5511999999999'
await removeRental(group)
assert.equal(await hasActiveRental(group), false)
await setRental(group, 15, false)
assert.equal(await hasActiveRental(group), true)
assert.equal((await getRental(group)).permanent, false)
await setRental(group, 30, true)
assert.equal((await getRental(group)).permanent, true)
await removeRental(group)

await removeVip(number)
assert.equal(await isVip(number), false)
await setVip(number, 30, false)
assert.equal(await isVip(number), true)
assert.equal((await getVip(number)).permanent, false)
assert.equal(vipBenefits().mediaLimitMb, 95)
await removeVip(number)

const commands = new Map([['menu', { name: 'menu', category: 'Principal', usage: '.menu' }]])
const header = buildMenuHeader(commands)
assert.equal(/\*base:\*|\*atalhos:\*|\*categorias:\*/i.test(header), false)
console.log('✅ Contratos, VIP e menu simplificado aprovados')
