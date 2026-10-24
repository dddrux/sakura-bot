process.env.SAKURA_AUTOMATION_DB ||= ':memory:'
const { loadCommands } = await import('../handler.js')
const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} }
const commands = await loadCommands(logger)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
for (const alias of ['automacoes', 'boasvindas', 'tiktokauto', 'rotina8', 'antiflood']) {
  assert(commands.has(alias), `comando/alias ausente: ${alias}`)
}
const command = commands.get('automacoes')
assert(command.groupOnly && command.adminOnly, 'painel de automações precisa ser restrito a administradores de grupo')
assert(command.menuEntries?.length >= 5, 'menu da Parte 8 incompleto')
console.log(`✅ Parte 8 UI: ${new Set([...commands.values()]).size} ações e ${commands.size} aliases; automações carregadas`)
