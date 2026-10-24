import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v0351-'))
process.env.SAKURA_CORE_DB = path.join(temporary, 'sakura-core.db')

const core = await import('../core-store.js')
const permissions = await import('../permissions.js')
const formatter = await import('../formatter.js')

const first = core.initializeCoreStore()
if (first.integrity !== 'ok' || first.schemaVersion < 3) throw new Error('Migração acumulativa do núcleo falhou')

const owner = '558199434137'
const subowner = '5516999999999'
core.addSubowner(subowner, owner)
if (!core.isSubowner(subowner)) throw new Error('Subdono não foi persistido')
if (!core.listSubowners().some(row => row.number === subowner)) throw new Error('Subdono não apareceu na listagem')

let ownerRejected = false
try { core.addSubowner(owner, owner) } catch { ownerRejected = true }
if (!ownerRejected) throw new Error('O dono principal foi aceito como subdono')

core.rememberUser({ number: subowner, jid: `${subowner}@s.whatsapp.net`, name: 'Pessoa Teste' })
if (core.getRememberedUser(subowner)?.name !== 'Pessoa Teste') throw new Error('Diretório de nomes não persistiu')

core.writeAudit({ actor: owner, action: 'teste.seguro', target: subowner, details: { token: 'segredo', value: 10 } })
const audit = core.listAudit(10).find(row => row.action === 'teste.seguro')
if (!audit || audit.details.token !== '[protegido]' || audit.details.value !== 10) throw new Error('Auditoria não protegeu segredo')

if (!permissions.hasPermission('subowner', permissions.PERMISSIONS.CONTRACTS)) throw new Error('Matriz não liberou contratos para subdono')
if (permissions.hasPermission('subowner', permissions.PERMISSIONS.SUBOWNERS)) throw new Error('Subdono recebeu permissão de promover subdonos')

const commandMap = new Map([
  ['menu', { name: 'menu' }],
  ['segredodono', { name: 'segredodono', ownerOnly: true }],
  ['contrato', { name: 'contrato', ownerOnly: true, subownerAllowed: true }]
])
if (formatter.findCommandSuggestions('segredodono', commandMap, 3, 'member').includes('segredodono')) throw new Error('Sugestão vazou comando de dono')
if (!formatter.findCommandSuggestions('contrat', commandMap, 3, 'subowner').includes('contrato')) throw new Error('Sugestão não respeitou subdono')

core.removeSubowner(subowner, owner)
if (core.isSubowner(subowner)) throw new Error('Subdono não foi removido')

core.closeCoreStore()
await fs.rm(temporary, { recursive: true, force: true })
console.log('✅ Parte 1: migração, subdonos, auditoria protegida, diretório de nomes e permissões aprovados')
