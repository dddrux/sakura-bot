import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shortAliases from '../short-aliases.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const config = JSON.parse(read('config/sakura.config.json'))
const pkg = JSON.parse(read('package.json'))
const interactiveSource = read('data/interactive.js')
const handlerSource = read('data/handler.js')
const funMediaSource = read('commands/fun-media.js')
const readme = read('README.md')

assert.ok(/^2\.0\.0-rc\.(?:[4-9]|[1-9]\d+)$/.test(pkg.version), 'RC4+ precisa manter release candidate 4 ou superior')
assert.ok(/^2\.0\.0-rc\.(?:[4-9]|[1-9]\d+)$/.test(config.bot.release), 'RC4+ precisa manter release candidate 4 ou superior')
assert.ok(Object.hasOwn(config.ui || {}, 'officialGroup'), 'ui.officialGroup precisa existir e aceitar vazio')
assert.match(config.ui.updateChannel || '', /^https:\/\/whatsapp\.com\/channel\//, 'canal de atualização deve continuar configurável')

assert.equal(typeof shortAliases.ensureShortAliases, 'function', 'registro automático de aliases curtos ausente')
assert.equal(typeof shortAliases.resetGeneratedShortAliases, 'function', 'reset de aliases gerados ausente para testes/reload')

if (typeof shortAliases.ensureShortAliases === 'function') {
  shortAliases.resetGeneratedShortAliases?.()
  const alpha = { name: 'comandomuitolongo', aliases: [], menuEntries: [{ name: 'comandomuitolongo' }] }
  const beta = { name: 'outrocomandolongo', aliases: [], menuEntries: [{ name: 'outrocomandolongo' }] }
  const commands = new Map([[alpha.name, alpha], [beta.name, beta]])
  const generated = shortAliases.ensureShortAliases(commands)
  assert.ok(generated.length >= 2, 'todas as ações sem atalho precisam receber alias curto')
  for (const row of generated) {
    assert.ok(row.alias.length >= 1 && row.alias.length <= 6, `alias ${row.alias} não é abreviado`)
    assert.equal(commands.get(row.alias), row.command, `alias ${row.alias} não foi registrado no command map`)
    assert.equal(shortAliases.canonicalShortTarget(row.alias), row.target, `alias ${row.alias} não canonicaliza para ${row.target}`)
  }
}

assert.match(interactiveSource, /MENU COMPLETO/, 'catálogo precisa de cabeçalho MENU COMPLETO')
assert.match(interactiveSource, /sendCompleteCommandCatalog/, 'catálogo completo de uma mensagem ausente')
assert.match(read('data/official-links.js'), /officialGroup/, 'menu precisa renderizar grupo oficial configurável')
assert.match(interactiveSource, /includeUpdateCta\s*:\s*true/, 'menu/catálogo devem integrar botões oficiais')
assert.doesNotMatch(handlerSource, /Acompanhe as atualizações oficiais da Sakura\./, 'handler não deve enviar segunda mensagem de atualização')
assert.match(handlerSource, /invokedAs:\s*canonicalAction/, 'aliases curtos precisam chegar ao comando como ação canônica')
assert.match(handlerSource, /rawInvokedAs:\s*commandName/, 'workstation deve preservar o alias bruto para diagnóstico')

assert.match(funMediaSource, /setmidia\s+on\|off/, 'mídia on/off precisa ser consolidada em .setmidia on|off')
assert.doesNotMatch(funMediaSource, /name:\s*['"]midiaon['"]|name:\s*['"]midiaoff['"]/, 'midiaon/off não devem aparecer como entradas separadas')

assert.match(readme, /commands\/<nome>\.js/i, 'README precisa dizer onde colocar o JS do comando')
assert.match(readme, /defineCommand\(/, 'README precisa documentar defineCommand()')
assert.match(readme, /menuEntries/, 'README precisa documentar menuEntries')

const commandDir = path.join(root, 'commands')
const ownership = new Map()
for (const file of fs.readdirSync(commandDir).filter(name => name.endsWith('.js'))) {
  const source = read(`commands/${file}`)
  const main = source.match(/defineCommand\s*\(\s*\{[\s\S]*?\bname\s*:\s*['"]([^'"]+)/)?.[1]
  const aliasesBlock = source.match(/\baliases\s*:\s*\[([\s\S]*?)\]/)?.[1] || ''
  const aliases = [...aliasesBlock.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
  for (const name of [main, ...aliases].filter(Boolean)) {
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const owner = ownership.get(key)
    assert.ok(!owner || owner === file, `alias/comando duplicado entre módulos: ${name} (${owner} e ${file})`)
    ownership.set(key, file)
  }
}

console.log('✅ RC4 menu/catalog: links, aliases, catálogo único e workstation aprovados')
