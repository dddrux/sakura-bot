import makeRawWASocket from './Socket/index.js'
import makeSakuraSocket from './Sakura/index.js'
export * from '../WAProto/index.js'
export * from './Utils/index.js'
export * from './Types/index.js'
export * from './Defaults/index.js'
export * from './WABinary/index.js'
export * from './WAM/index.js'
export * from './WAUSync/index.js'
export * from './Sakura/index.js'
export { makeRawWASocket, makeSakuraSocket }
export const makeWASocket = makeSakuraSocket
export default makeSakuraSocket
