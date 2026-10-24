import assert from 'node:assert/strict'
import { flattenConfig, getValue, setValue, coerceValue, addOwner, removeOwner, listOwners, createWizard } from '../terminal-config.js'
import { createConsoleCommands, completeLine } from '../terminal-console.js'

process.env.NO_COLOR = '1'
const strip = v => String(v).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
const fresh = () => ({
  bot: { name: 'Sakura-MD', number: '558100000000', prefix: '.', release: '2.0', codename: 'Hanami' },
  owners: [{ name: 'Drux', number: '5581999434137', role: 'owner', enabled: true }],
  ai: { enabled: true, model: 'm1', tokens: ['x'], models: [] },
  tts: { enabled: true, key: 'SEGREDO', region: '' },
  ui: { footer: 'f', autoFormat: true },
  panel: { enabled: true, port: 3000 },
  runtime: { logLevel: 'info' },
  vip: { enabled: true }
})
function makeIo() {
  let cfg = fresh()
  const live = []
  return { cfg: () => cfg, live, read: () => JSON.parse(JSON.stringify(cfg)), write: patch => { for (const [k, v] of Object.entries(patch)) cfg[k] = Array.isArray(v) ? v : { ...cfg[k], ...v } }, applyLive: key => { live.push(key); return ['bot.prefix', 'bot.name', 'ai.enabled', 'ui.footer', 'owners'].includes(key) } }
}

// coerção e listas
assert.deepEqual(coerceValue('sim', true), { ok: true, value: true })
assert.deepEqual(coerceValue('off', true), { ok: true, value: false })
assert.equal(coerceValue('talvez', true).ok, false)
assert.deepEqual(coerceValue('3,5', 1), { ok: true, value: 3.5 })
assert.equal(coerceValue('abc', 1).ok, false)
const paths = flattenConfig(fresh()).map(([p]) => p)
assert.ok(paths.includes('ui.footer') && paths.includes('panel.port'))
assert.ok(!paths.includes('ai.tokens') && !paths.includes('ai.models'), 'listas não são editáveis')
assert.ok(!paths.includes('bot.release') && !paths.includes('bot.codename'), 'somente leitura fica fora')
assert.equal(getValue(fresh(), 'tts.key'), '••••••', 'segredo mascarado')
assert.equal(getValue(fresh(), 'ui.footer'), 'f')

// setValue
let io = makeIo()
assert.equal(setValue(io, 'bot.prefix', '!').ok, true); assert.equal(io.cfg().bot.prefix, '!'); assert.ok(io.live.includes('bot.prefix'))
assert.match(setValue(io, 'bot.prefix', '').message, /prefixo/)
assert.match(setValue(io, 'bot.prefix', 'abcde').message, /prefixo/)
assert.equal(setValue(io, 'panel.port', '99999').ok, false)
const portOk = setValue(io, 'panel.port', '3100'); assert.equal(portOk.ok, true); assert.equal(portOk.restart, true); assert.equal(io.cfg().panel.port, 3100)
assert.equal(setValue(io, 'ai.enabled', 'off').ok, true); assert.equal(io.cfg().ai.enabled, false)
assert.match(setValue(io, 'bot.release', 'x').message, /somente leitura/)
assert.match(setValue(io, 'ai.tokens', 'x').message, /lista/)
assert.match(setValue(io, 'foo.bar', 'x').message, /não existe/)
assert.match(setValue(io, 'tts.key', 'NOVO').message, /••••••/)
assert.equal(io.cfg().tts.key, 'NOVO')

// donos
io = makeIo()
assert.equal(addOwner(io, '123', 'x').ok, false)
assert.equal(addOwner(io, '+55 (81) 98888-7777', 'Ana').ok, true)
assert.deepEqual(listOwners(io).map(o => o.number), ['5581999434137', '5581988887777'])
assert.equal(addOwner(io, '5581988887777').ok, false)
assert.equal(removeOwner(io, '5581988887777').ok, true)
assert.match(removeOwner(io, '5581999434137').message, /único dono/)

// assistente
io = makeIo()
const wiz = createWizard(io)
assert.match(wiz.prompt(), /^\(1\/7\) Nome do bot \[Sakura-MD\]/)
assert.equal(wiz.answer('Hanami Bot').done, false)   // 1 nome
assert.match(wiz.answer('12').error, /inválido/)       // 2 número do bot inválido (repete a pergunta)
assert.equal(wiz.answer('').done, false)               // 2 mantém
assert.equal(wiz.answer('').done, false)               // 3 nome do dono (mantém)
assert.equal(wiz.answer('5581977776666').done, false)  // 4 número do dono
assert.match(wiz.answer('muito longo').error, /prefixo/) // 5
assert.equal(wiz.answer('!').done, false)
assert.match(wiz.answer('talvez').error, /on\/off/)     // 6
assert.equal(wiz.answer('off').done, false)
const end = wiz.answer('')
assert.equal(end.done, true); assert.match(end.message, /salva/)
assert.equal(io.cfg().bot.name, 'Hanami Bot'); assert.equal(io.cfg().bot.prefix, '!'); assert.equal(io.cfg().ai.enabled, false)
assert.equal(io.cfg().owners[0].number, '5581977776666'); assert.equal(io.cfg().owners[0].name, 'Drux')
assert.equal(createWizard(makeIo()).answer('cancelar').cancelled, true)

// integração com o console
io = makeIo()
const run = createConsoleCommands({ config: io, getStatus: () => ({}), defaultLogLevel: 'warn', shutdown: async () => {} })
assert.match(strip(await run('config')), /bot\.prefix\s+\.[\s\S]*seções:/)
assert.match(strip(await run('config ui')), /ui\.footer\s+f/)
assert.match(strip(await run('config tts.key')), /••••••/)
assert.ok(!strip(await run('config tts')).includes('SEGREDO'))
assert.match(strip(await run('config ui.footer Minha frase nova')), /ui\.footer = Minha frase nova/)
assert.equal(io.cfg().ui.footer, 'Minha frase nova')
assert.match(strip(await run('prefixo ?')), /bot\.prefix = \?/)
assert.match(strip(await run('nome Flor')), /bot\.name = Flor/)
assert.match(strip(await run('dono')), /5581999434137\s+Drux/)
assert.match(strip(await run('dono add 5581966665555 Bia')), /adicionado/)
assert.match(strip(await run('assistente')), /1\/7/)
assert.equal(run.inWizard(), true)
assert.match(strip(await run('Nome Teste')), /2\/7/)
assert.match(strip(await run('cancelar')), /cancelado/)
assert.equal(run.inWizard(), false)
assert.match(strip(await run('ajuda')), /Configurar[\s\S]*Controlar[\s\S]*Sistema/)
const noCfg = createConsoleCommands({ getStatus: () => ({}) })
assert.match(strip(await noCfg('config')), /indisponível/)

// Tab
assert.deepEqual(completeLine('con', { config: io })[0], ['config'])
assert.ok(completeLine('config ui.', { config: io })[0].includes('ui.footer'))
assert.deepEqual(completeLine('dono r', { config: io })[0], ['remover'])
assert.deepEqual(completeLine('log de', { config: io })[0], ['debug'])
console.log('✅ Config pelo terminal: valores, donos, assistente, Tab e segredos aprovados')
