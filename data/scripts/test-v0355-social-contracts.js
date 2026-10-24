import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0355-social-'))
process.env.SAKURA_DB_FILE = path.join(temporary, 'sakura-db.json')

const social = await import('../social-store.js')
const { parseDuration } = await import('../duration.js')
const rentals = await import('../rentals.js')
const vip = await import('../vip.js')
const core = await import('../core-store.js')

const alice = '5581999995101'
const bob = '5581999995102'
const child = '5581999995103'
const chat = '120363055500000001@g.us'

const dating = social.createSocialRequest({ type: 'dating', chat, requester: alice, target: bob })
if (!dating.id.startsWith('SOC-')) throw new Error('pedido de namoro sem ID seguro')
const wrong = social.resolveSocialRequest({ id: dating.id, actor: alice, chat, decision: 'accepted' })
if (wrong.ok || wrong.reason !== 'target') throw new Error('autor aceitou o próprio pedido')
const acceptedDating = social.resolveSocialRequest({ id: dating.id, actor: bob, chat, decision: 'accepted' })
if (!acceptedDating.ok || social.getRelationship(alice)?.partner !== bob) throw new Error('namoro não foi persistido')

const marriage = social.createSocialRequest({ type: 'marriage', chat, requester: alice, target: bob })
const acceptedMarriage = social.resolveSocialRequest({ id: marriage.id, actor: bob, chat, decision: 'accepted' })
if (!acceptedMarriage.ok || social.getRelationship(alice)?.status !== 'married') throw new Error('casamento não foi persistido')

const adoption = social.createSocialRequest({ type: 'adoption', chat, requester: alice, target: child })
if (!social.resolveSocialRequest({ id: adoption.id, actor: child, chat, decision: 'accepted' }).ok) throw new Error('adoção não foi aceita')
if (social.getFamily(alice).children[0]?.child !== child) throw new Error('filho não apareceu na família')
let cycleBlocked = false
try { social.createSocialRequest({ type: 'adoption', chat, requester: child, target: alice }) } catch (error) { cycleBlocked = /ciclo/i.test(error.message) }
if (!cycleBlocked) throw new Error('adoção circular não foi bloqueada')

social.recordSocialAction({ chat, action: 'abracar', actor: alice, target: bob })
social.recordSocialAction({ chat, action: 'abracar', actor: alice, target: bob })
if (Number(social.actionRanking(chat, 10)[0]?.actions || 0) !== 2) throw new Error('ações sociais não foram contabilizadas')
if (!social.coupleRanking(10).length || !social.familyRanking(10).length) throw new Error('rankings sociais vazios')

const removedFamily = social.removeFamilyLink({ actor: child, target: alice, chat })
if (!removedFamily.ok || social.getFamily(alice).children.length) throw new Error('remoção familiar falhou')
const divorce = social.endRelationship({ actor: alice, expectedStatus: 'married', chat })
if (!divorce.ok || social.getRelationship(alice)) throw new Error('divórcio não encerrou relacionamento')
if (social.listSocialHistory(alice, 20).length < 5) throw new Error('histórico social incompleto')

const twoHours = parseDuration('2h')
const fortyFiveMinutes = parseDuration('45min')
const lifetime = parseDuration('vitalicio')
if (twoHours?.ms !== 7_200_000 || fortyFiveMinutes?.ms !== 2_700_000 || !lifetime?.permanent) throw new Error('parser de duração falhou')

const rental = await rentals.setRentalDuration(chat, fortyFiveMinutes, alice)
const renewed = await rentals.renewRental(chat, twoHours, alice)
if (renewed.expiresAt <= rental.expiresAt || !(await rentals.rentalHistory(chat, 10)).length) throw new Error('renovação do contrato falhou')
await rentals.cancelRental(chat, alice)
if ((await rentals.getRental(chat)).valid) throw new Error('cancelamento de contrato falhou')

const expiringRental = await rentals.setRentalDuration(chat, { ms: 60_000, permanent: false }, alice)
const rentalNotices = await rentals.collectRentalNotices(expiringRental.expiresAt + 1)
if (rentalNotices[0]?.stage !== 4 || !rentalNotices[0]?.expired || (await rentals.getRental(chat)).valid) {
  throw new Error('expiração persistente do contrato falhou')
}

const vipRow = await vip.setVipDuration(bob, twoHours, alice)
const vipRenewed = await vip.renewVip(bob, fortyFiveMinutes, alice)
if (vipRenewed.expiresAt <= vipRow.expiresAt || !(await vip.vipHistory(bob, 10)).length) throw new Error('renovação VIP falhou')
await vip.cancelVip(bob, alice)
if (await vip.isVip(bob)) throw new Error('cancelamento VIP falhou')

const expiringVip = await vip.setVipDuration(bob, { ms: 60_000, permanent: false }, alice)
const vipNotices = await vip.collectVipNotices(expiringVip.expiresAt + 1)
if (vipNotices[0]?.stage !== 4 || !vipNotices[0]?.expired || await vip.isVip(bob)) {
  throw new Error('expiração persistente do VIP falhou')
}

const status = core.initializeCoreStore()
if (status.schemaVersion < 5 || status.expectedSchemaVersion < 5) throw new Error('núcleo não preservou o schema mínimo da Parte 5')
if (social.getSocialStatus().schemaVersion !== 2) throw new Error('social JSON não inicializou no schema V2')

social.closeSocialStore()
core.closeCoreStore()
fs.rmSync(temporary, { recursive: true, force: true })
console.log('✅ Parte 5: consentimento, namoro, casamento, adoção, histórico, ações, contratos e VIP personalizados aprovados')
