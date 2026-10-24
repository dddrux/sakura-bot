import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installHint, platformLabel } from './data/platform.js'
import fs from 'node:fs'
import { loadEnvFile } from './data/env.js'
import { restorePersistentBackup } from './data/backup-manager.js'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const packageVersion = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version
process.env.FONTCONFIG_FILE ||= path.join(rootDir, 'config', 'fontconfig.xml')

function printFatal(error) {
  const message = error?.message || String(error)
  console.error('\n❌ A Sakura-MD não conseguiu iniciar.')
  console.error(`Plataforma: ${platformLabel()}`)
  console.error(`Erro: ${message}`)
  if (error?.code) console.error(`Código: ${error.code}`)

  if (error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package|Cannot find module/i.test(message)) {
    console.error(`\nExecute ${installHint()} para reparar as dependências.`)
    console.error('O nome exato da dependência ausente foi exibido acima; o erro não é mais ocultado.')
  } else if (error?.code === 'SAKURA_SHARP_UNAVAILABLE') {
    console.error('\nO Sharp não carregou. Em ARM, instale ImageMagick; em outras plataformas, rode o instalador completo.')
  }
  if (process.env.LOG_LEVEL === 'debug' || process.env.SAKURA_STARTUP_TRACE === '1') console.error(error?.stack || error)
  console.error('')
}

async function main() {
  try {
    const restored = await restorePersistentBackup({ rootDir, release: packageVersion })
    if (restored.restored) console.log(`💾 Backup persistente restaurado automaticamente (${restored.restoredCount} item(ns)${restored.discovered ? ', detectado sem manifest' : ''}).`)
    loadEnvFile(path.join(rootDir, '.env'))
    const { initializeCoreStore } = await import('./data/core-store.js')
    const core = initializeCoreStore()
    if (core.backupPath) console.log(`💾 Backup pré-migração criado em: ${core.backupPath}`)
    const { startClient } = await import('./data/client.js')
    await startClient()
  } catch (error) {
    printFatal(error)
    process.exitCode = 1
  }
}

void main()
