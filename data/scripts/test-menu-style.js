import assert from 'node:assert/strict'
import { alt, itemTitle, sectionTitle, buttonLabel, menuBox, stripLeading } from '../menu-style.js'
import { buildCommandSections, buildCompleteCatalogText, buildMenuHeader, styleNativeSections, styleButtonText } from '../interactive.js'

// padrão 💮/🌸 alternado
assert.deepEqual([0, 1, 2, 3].map(alt), ['💮', '🌸', '💮', '🌸'])
assert.equal(stripLeading('💰 Saldo'), 'Saldo')
assert.equal(stripLeading('▢ • 🌸 Saldo'), 'Saldo')
assert.equal(itemTitle('💰 Saldo', 1), '🌸 Saldo')
assert.equal(sectionTitle('💮 Catálogos'), '🪷 Catálogos')
assert.equal(buttonLabel('🌸 abrir lista'), '💮 Abrir lista')
assert.equal(buttonLabel('🔗 grupo oficial'), '🔗 Grupo oficial')
assert.equal(menuBox('X', ['a', 'b', 'c']), '╭━━⪩ 🪷 *X* ⪨━━\n▢ • 💮 a\n▢ • 🌸 b\n▢ • 💮 c\n╰━━─「🪷」─━━')

// categorias
const cmds = new Map()
const mk = (name, category) => ({ name, aliases: [], category, description: `desc ${name}`, usage: `.${name}`, async execute() {} })
for (const c of [mk('menu', 'Principal'), mk('s', 'Mídia'), mk('saldo', 'Economia'), mk('top', 'Rankings'), mk('ranks', 'Ranks'), mk('admin', 'Admin')]) cmds.set(c.name, c)
const titles = buildCommandSections(cmds).map(s => s.title)
assert.equal(titles.filter(t => t === 'Ranks').length, 1, 'Ranks/Rankings devem ser uma categoria só')
assert.ok(!titles.includes('Rankings') && !titles.includes('Admin'))

// cabeçalho e catálogo seguem o padrão e não duplicam negrito
const header = buildMenuHeader(cmds)
assert.match(header, /^╭━━⪩ 🪷 \*MENU PRINCIPAL\* ⪨━━\n▢ • 💮 \*.+\*\n▢ • 🌸 \*dono:\*/)
for (const text of [header, buildCompleteCatalogText(cmds)]) {
  assert.ok(!/\*[^*\n]+:\* \*/.test(text), 'sem negrito duplo em "campo: valor"')
  const bullets = text.split('\n').filter(l => l.startsWith('▢'))
  let expected = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('╭')) expected = 0
    else if (line.startsWith('▢')) { assert.ok(line.startsWith(`▢ • ${alt(expected)} `), `alternância quebrada: ${line}`); expected += 1 }
  }
  assert.ok(bullets.length > 0)
}

// listas: sempre o padrão por posição, ignorando emoji de origem; seção 🪷
const styled = styleNativeSections([{ title: '💮 Catálogos', rows: [{ id: 'a', title: '🌸 Um' }, { id: 'b', title: '💰 Dois' }, { id: 'c', title: 'Três' }] }])
assert.equal(styled[0].title, '🪷 Catálogos')
assert.deepEqual(styled[0].rows.map(r => r.title), ['💮 Um', '🌸 Dois', '💮 Três'])
assert.equal(styleButtonText('🌸 Ver comandos'), '💮 Ver comandos')
assert.equal(styleButtonText('🔗 Grupo oficial da sakura'), '🔗 Grupo oficial da sakura')
console.log('✅ Menus: padrão 💮/🌸 alternado em tudo, categorias únicas, cabeçalhos padronizados')
