// Assistente de configuração (sem iniciar o bot): npm run configure
import readline from 'node:readline'
import process from 'node:process'
import { readConfig, writeConfigSync } from '../settings.js'
import { createWizard } from '../terminal-config.js'

const wizard = createWizard({ read: readConfig, write: writeConfigSync })
const rl = readline.createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) })
console.log('\nAssistente de configuração da Sakura — Enter mantém o valor atual, "cancelar" sai.\n')
process.stdout.write(`${wizard.prompt()}: `)
let finished = false
for await (const line of rl) {
  const result = wizard.answer(line)
  if (result.error) console.log(`× ${result.error}`)
  if (result.done) { console.log(`\n${result.cancelled ? '›' : '✓'} ${result.message}\n`); finished = true; break }
  process.stdout.write(`${result.message}: `)
}
if (!finished) console.log('\n› entrada encerrada — nada foi salvo\n')
rl.close()
