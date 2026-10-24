import { platformInfo, platformLabel } from '../platform.js'

console.log(`Plataforma: ${platformLabel()}`)
console.log(`Node: ${platformInfo.node}`)
console.log(`CPUs: ${platformInfo.cpus}`)
console.log(`RAM: ${platformInfo.totalMemoryMb} MB`)
console.log(`Raspberry Pi: ${platformInfo.isRaspberryPi ? 'sim' : 'não'}`)
console.log(`Termux: ${platformInfo.isTermux ? 'sim' : 'não'}`)
console.log(`Modo de mídia: ${platformInfo.mediaMode}`)
