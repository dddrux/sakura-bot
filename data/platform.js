import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/\0/g, '').trim() } catch { return '' }
}

function detectRaspberryPi() {
  const model = readText('/proc/device-tree/model') || readText('/sys/firmware/devicetree/base/model')
  return { isRaspberryPi: /raspberry pi/i.test(model), model }
}

function detectTermux() {
  const prefix = String(process.env.PREFIX || '')
  return Boolean(process.env.TERMUX_VERSION || /com\.termux/i.test(prefix) || /termux/i.test(process.env.HOME || ''))
}

function detectWindowsShell() {
  if (process.platform !== 'win32') return ''
  if (process.env.PSModulePath) return 'PowerShell'
  return process.env.ComSpec ? path.basename(process.env.ComSpec) : 'Windows'
}

const raspberry = detectRaspberryPi()
const totalMemoryMb = Math.round(os.totalmem() / 1024 / 1024)
const isTermux = detectTermux()
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'
const isArm32 = process.arch === 'arm'
const isArm64 = process.arch === 'arm64'
const isLowMemory = totalMemoryMb > 0 && totalMemoryMb <= 1536
const forcedMode = String(process.env.SAKURA_MEDIA_MODE || '').trim().toLowerCase()
const mediaMode = ['inline', 'process'].includes(forcedMode)
  ? forcedMode
  : (isTermux || isArm32 || isLowMemory ? 'inline' : 'process')

export const platformInfo = Object.freeze({
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  node: process.version,
  cpus: os.cpus()?.length || 1,
  totalMemoryMb,
  isWindows,
  isLinux,
  isMac,
  isTermux,
  isRaspberryPi: raspberry.isRaspberryPi,
  raspberryModel: raspberry.model,
  isArm32,
  isArm64,
  isLowMemory,
  mediaMode,
  shell: detectWindowsShell()
})

export function platformLabel(info = platformInfo) {
  if (info.isTermux) return `Termux ${info.arch}`
  if (info.isRaspberryPi) return `${info.raspberryModel || 'Raspberry Pi'} ${info.arch}`
  if (info.isWindows) return `Windows ${info.arch}`
  if (info.isMac) return `macOS ${info.arch}`
  return `${info.platform} ${info.arch}`
}

export function installHint(info = platformInfo) {
  if (info.isWindows) return '.\\install.bat'
  return './install.sh'
}
