import {
  beginTransfer,
  buyItem,
  confirmTransfer,
  craftItem,
  daily,
  deposit,
  getAccount,
  getInventory,
  getStatement,
  register,
  useItem,
  work
} from '../economy.js'

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const from = `5511${suffix.slice(-9)}`
const to = `5521${suffix.slice(-9)}`

const first = await register(from)
if (!first.created || first.account.wallet < 250) throw new Error('registro inicial inválido')
await register(to)

const harvest = await daily(from)
if (!harvest.ok || harvest.reward <= 0) throw new Error('diário inválido')
const shift = await work(from)
if (!shift.ok || shift.reward <= 0) throw new Error('trabalho inválido')

const beforeDeposit = await getAccount(from)
const depositValue = Math.min(20, beforeDeposit.wallet)
const deposited = await deposit(from, depositValue)
if (!deposited.ok || deposited.account.bank < depositValue) throw new Error('depósito inválido')

const pending = await beginTransfer(from, to, 20)
if (!pending.ok || !pending.id) throw new Error('PIX pendente não criado')
const confirmed = await confirmTransfer(pending.id, from)
if (!confirmed.ok || confirmed.amount !== 20) throw new Error('PIX não confirmado')

for (const [item, quantity] of [['madeira', 2], ['fita', 1]]) {
  const purchased = await buyItem(from, item, quantity)
  if (!purchased.ok) throw new Error(`compra de material falhou: ${item}`)
}
const materialUse = await useItem(from, 'madeira')
if (materialUse.ok || materialUse.reason !== 'material') throw new Error('material pôde ser usado fora do ateliê')
const crafted = await craftItem(from, 'chave')
if (!crafted.ok) throw new Error('criação no ateliê falhou')
const inventory = await getInventory(from)
if (!inventory.some(item => item.id === 'chave')) throw new Error('item criado ausente na mochila')
const used = await useItem(from, 'chave')
if (!used.ok || used.reward <= 0) throw new Error('uso da chave falhou')
const statement = await getStatement(from, 20)
if (!statement.some(entry => entry.type === 'transfer') || !statement.some(entry => entry.type === 'shop')) throw new Error('extrato incompleto')

console.log('✅ Economia Sakura: registro, diário, trabalho, cofre, PIX confirmado, loja, ateliê, mochila e extrato validados')
