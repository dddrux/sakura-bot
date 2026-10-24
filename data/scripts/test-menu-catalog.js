import { createSakuraCommandList } from '@sakura-md/baileys'
import { sendInventory } from '../economy-ui.js'
import { loadCommands } from '../handler.js'
import {
  buildCommandSections,
  getAliasCatalogEntries,
  getVisibleMenuCommands,
  prepareNativeSections,
  resolveCatalogEntry,
  sendAliasCatalog,
  sendCommandCatalog,
  sendCommandList,
  sendCommandSearch
} from '../interactive.js'

const logger = new Proxy({}, { get: () => () => {} })
const commands = await loadCommands(logger)
const curated = getVisibleMenuCommands(commands)
const aliases = getAliasCatalogEntries(commands)
const normalizeAlias = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
const expectedAliasCount = new Set(
  [...commands.entries()]
    .filter(([registeredName, command]) => command && !command.hidden && !command.menuHiddenAliases?.includes?.(registeredName))
    .map(([registeredName]) => normalizeAlias(registeredName))
    .filter(Boolean)
).size

if (curated.length < 72) throw new Error(`catálogo incompleto: ${curated.length} ações`)
if (aliases.length !== expectedAliasCount) throw new Error(`atalhos incompletos: ${aliases.length}/${expectedAliasCount} únicos (${commands.size} nomes registrados)`)
if (commands.get('musica') !== commands.get('música')) throw new Error('aliases musica/música não apontam para o mesmo comando')

const sections = buildCommandSections(commands)
const economy = sections.find(section => section.title === 'Economia')
const administration = sections.find(section => section.title === 'Administração')
const requiredEconomy = ['registrar', 'depositar', 'sacar', 'rendimento', 'comprar', 'vender', 'usar', 'criar', 'conquistas']
const requiredAdmin = ['ban', 'promover', 'rebaixar', 'grupo', 'linkgp', 'novolink', 'hidetag', 'nomegp', 'descgp', 'admins']
for (const name of requiredEconomy) if (!economy?.commands.some(command => command.name === name)) throw new Error(`economia não exibe ${name}`)
for (const name of requiredAdmin) if (!administration?.commands.some(command => command.name === name)) throw new Error(`administração não exibe ${name}`)

for (const entry of curated) {
  if (!resolveCatalogEntry(commands, entry.name)) throw new Error(`entrada sem resolução: ${entry.name}`)
}
if (resolveCatalogEntry(commands, 'recompensadiaria')?.menuSource !== 'eco') throw new Error('atalho recompensadiaria não foi resolvido')

const split = prepareNativeSections([{
  title: '🌸 Catálogo grande',
  rows: Array.from({ length: 28 }, (_, index) => ({ id: `.teste${index}`, title: `.teste${index}` }))
}])
if (split.sections.length !== 3 || split.hiddenRows !== 0 || split.sections.some(section => section.rows.length > 10)) {
  throw new Error('paginação preventiva de linhas falhou')
}


const forkSplit = createSakuraCommandList({
  body: 'teste',
  sections: [{
    title: 'Catálogo extenso',
    rows: Array.from({ length: 23 }, (_, index) => ({ id: `.fork${index}`, title: `.fork${index}` }))
  }]
})
const forkSections = forkSplit.nativeFlow?.[0]?.sections || []
if (forkSections.length !== 3 || forkSections.some(section => section.rows.length > 10)) throw new Error('fork não dividiu catálogo extenso')

const sent = []
const sock = {
  user: { id: '5581999999999@s.whatsapp.net' },
  waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/menu.jpg', directPath: '/menu.jpg' }),
  async sendMessage(jid, content) {
    sent.push({ jid, content, mode: 'send' })
    return { key: { id: `MENU-${sent.length}` } }
  },
  async relayMessage(jid, message, options) {
    sent.push({ jid, message, options, mode: 'relay' })
    return options.messageId
  }
}
const msg = { key: { remoteJid: '120363000000000000@g.us' } }

await sendCommandList({ sock, msg, commands, category: 'Economia', logger })
await sendCommandCatalog({ sock, msg, commands, page: 1, logger })
await sendAliasCatalog({ sock, msg, commands, page: 1, logger })
await sendCommandSearch({ sock, msg, commands, query: 'recompensa', logger })

const fakeInventory = Array.from({ length: 16 }, (_, index) => ({
  id: `item${index}`,
  icon: '🌸',
  name: `Item ${index}`,
  quantity: 1,
  kind: index % 3 === 0 ? 'material' : 'item',
  description: 'Item de teste',
  sell: 10
}))
await sendInventory({ sock, msg, account: { wallet: 1000 }, inventory: fakeInventory, logger })


function nativeSectionsOf(item) {
  if (item.content?.nativeFlow?.[0]?.sections) return item.content.nativeFlow[0].sections
  const button = item.message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage?.buttons?.find(value => value?.name === 'single_select')
  if (!button?.buttonParamsJson) return []
  return JSON.parse(button.buttonParamsJson).sections || []
}

for (const [index, item] of sent.entries()) {
  const nativeSections = nativeSectionsOf(item)
  if (!nativeSections.length) throw new Error(`menu ${index + 1} sem seções`)
  if (nativeSections.length > 10) throw new Error(`menu ${index + 1} excedeu 10 seções`)
  if (nativeSections.some(section => section.rows.length > 10)) throw new Error(`menu ${index + 1} excedeu 10 linhas por seção`)
  if (item.mode === 'relay' && !item.options?.additionalNodes?.some(node => node?.tag === 'biz')) throw new Error(`menu ${index + 1} sem nó biz`)
}

const economyIds = nativeSectionsOf(sent[0]).flatMap(section => section.rows.map(row => row.id))
if (!economyIds.includes('.dp') || !economyIds.includes('.ci') || !(economyIds.includes('.pf') || economyIds.includes('.menu command perfil'))) throw new Error(`lista de economia perdeu atalhos/modelo: ${economyIds.join(',')}`)
const catalogIds = nativeSectionsOf(sent[1]).flatMap(section => section.rows.map(row => row.id))
if (!catalogIds.some(id => id === '.m catalog 2')) throw new Error('catálogo completo ficou sem próxima página')
const searchIds = nativeSectionsOf(sent[3]).flatMap(section => section.rows.map(row => row.id))
if (!searchIds.some(id => decodeURIComponent(id).includes('recompensadiaria'))) throw new Error('pesquisa não encontrou recompensadiaria')

const inventorySections = nativeSectionsOf(sent[4])
const inventoryIds = inventorySections.flatMap(section => section.rows.map(row => row.id))
if (!inventoryIds.some(id => id === '.vender item15') || inventorySections.some(section => section.rows.length > 10)) throw new Error('mochila cortou itens do catálogo')

console.log(`✅ Catálogos: ${curated.length} ações, ${aliases.length} atalhos únicos (${commands.size} nomes registrados), categorias completas, pesquisa e listas 10x10 aprovadas`)
