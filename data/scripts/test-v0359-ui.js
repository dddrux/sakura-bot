import assert from 'node:assert/strict'
import { loadCommands } from '../handler.js'
import { findCommandSuggestions } from '../formatter.js'

const silent = { debug() {}, info() {}, warn() {}, error() {}, success() {} }
const commands = await loadCommands(silent)
const tutorial = commands.get('tutorial')
const calculator = commands.get('calculadora')
assert(tutorial, 'tutorial não carregou')
assert(calculator, 'calculadora não carregou')
assert.equal(commands.get('tuto'), tutorial)
assert.equal(commands.get('calc'), calculator)
assert.equal(calculator.ownerOnly, undefined)
assert.match(calculator.description, /sem usar eval/i)
assert(findCommandSuggestions('calculdora', commands, 3, 'member').includes('calculadora'), 'sugestão da calculadora falhou')
assert(findCommandSuggestions('tutoria', commands, 3, 'member').includes('tutorial'), 'sugestão do tutorial falhou')
assert(!findCommandSuggestions('groqtoke', commands, 3, 'member').includes('iatoken'), 'comando secreto foi sugerido a membro')
assert(findCommandSuggestions('contrat', commands, 3, 'subowner').includes('contrato'), 'contrato não foi sugerido ao subdono')
console.log(`✅ Parte 9 UI: ${new Set([...commands.values()]).size} ações e ${commands.size} aliases; tutorial, calculadora e sugestões carregados`)
