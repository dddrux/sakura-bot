import fs from 'node:fs/promises'
import path from 'node:path'
import { settings } from '../settings.js'

const slug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
const [rawName, rawCategory = 'Principal'] = process.argv.slice(2)
const name = slug(rawName)
if (!name) {
  console.error('Uso: npm run new:command -- nome "Categoria"')
  process.exitCode = 1
} else {
  const target = path.join(settings.commandsDir, `${name}.js`)
  try { await fs.access(target); throw new Error(`O comando ${name} já existe em ${target}`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const category = String(rawCategory || 'Principal').replace(/[\r\n'"`]/g, '').trim() || 'Principal'
  const source = `import { defineCommand } from '../data/workstation.js'\nimport { reply } from '../data/reply.js'\n\nexport default defineCommand({\n  name: '${name}',\n  aliases: [],\n  category: '${category}',\n  usage: '${settings.prefix}${name}',\n  description: 'Descreva o comando.',\n  reaction: '🌸',\n  slash: { model: '${settings.prefix}${name}', categories: ['${category.toLowerCase()}'], copyable: true },\n  async execute(ctx) {\n    const { sock, msg } = ctx\n    return reply(sock, msg, 'Comando V2 funcionando.', { title: '${name.toUpperCase()}' })\n  }\n})\n`
  await fs.writeFile(target, source, { flag: 'wx' })
  console.log(`🌸 comando criado: ${target}`)
  console.log('💮 edite execute(ctx) livremente; o contrato V2 não limita lógica assíncrona, listas, mídia ou banco.')
}
