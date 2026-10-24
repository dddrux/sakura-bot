import { loadCommands } from '../handler.js'

const logger = { debug() {}, info() {}, success() {}, warn() {}, error() {} }
const commands = await loadCommands(logger)
const required = ['s20', 's5', 's10', 'figlote', 'fig60', 'figsemcorte', 'figredonda', 'figborda', 'figtexto', 'bibliotecafig', 'figsorteio', 'take']
for (const name of required) if (!commands.has(name)) throw new Error(`comando/alias ausente: ${name}`)
if (commands.get('bibliotecafig')?.ownerOnly !== true) throw new Error('controle da biblioteca não está restrito ao dono')
if (commands.get('fig60')?.name !== 'figvip') throw new Error('fig60 não aponta para o módulo VIP')
if (!/Autor/.test(commands.get('take')?.usage || '')) throw new Error('take não documenta metadados completos')
console.log(`✅ Parte 6 UI: ${new Set([...commands.values()]).size} ações e ${commands.size} aliases; lote, VIP, biblioteca e sorteio carregados`)
