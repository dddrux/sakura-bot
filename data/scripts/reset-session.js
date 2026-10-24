import fs from 'node:fs/promises'
import path from 'node:path'
import { settings } from '../settings.js'

// O index.js restaura backup/auth por cima de auth/ a cada inicialização.
// Se o backup da sessão morta não for removido junto, o 401 volta em loop.
const backupAuthDir = path.join(path.dirname(settings.sessionDir), 'backup', path.basename(settings.sessionDir))

await fs.rm(settings.sessionDir, { recursive: true, force: true })
await fs.rm(backupAuthDir, { recursive: true, force: true })
await fs.mkdir(settings.sessionDir, { recursive: true })
await fs.writeFile(`${settings.sessionDir}/.gitkeep`, '')
console.log('✅ Sessão (auth/ e backup/auth/) removida. Execute npm start para gerar um novo QR.')
