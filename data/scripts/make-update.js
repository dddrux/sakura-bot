import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createUpdatePackage } from '../update-manager.js'
import { settings } from '../settings.js'

const [sourceArg, versionArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !versionArg) {
  console.error('Uso: npm run make-update -- ./pasta-da-atualizacao 0.20.0 [arquivo.sakura-update]')
  process.exit(1)
}

let panel = { version: 1, passwordHash: '', salt: '', updateSecret: '', createdAt: '' }
try { panel = JSON.parse(await fs.readFile(settings.panelDb, 'utf8')) } catch {}
if (!panel.updateSecret) {
  panel.updateSecret = randomBytes(32).toString('hex')
  panel.createdAt ||= new Date().toISOString()
  await fs.mkdir(path.dirname(settings.panelDb), { recursive: true })
  await fs.writeFile(settings.panelDb, `${JSON.stringify(panel, null, 2)}\n`)
}

const output = path.resolve(outputArg || path.join(settings.updatesDir, `sakura-${versionArg}.sakura-update`))
const result = await createUpdatePackage(path.resolve(sourceArg), versionArg, output, panel.updateSecret)
console.log(`✅ Atualização criada: ${result.outputPath}`)
console.log(`✅ Arquivos: ${result.files}`)
