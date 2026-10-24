import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const windows = process.platform === 'win32'
const command = windows ? 'powershell.exe' : 'bash'
const args = windows
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1')]
  : [path.join(root, 'install.sh')]

const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: false })
child.on('error', error => {
  console.error(`Falha ao abrir o instalador: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', code => { process.exitCode = Number(code) || 0 })
