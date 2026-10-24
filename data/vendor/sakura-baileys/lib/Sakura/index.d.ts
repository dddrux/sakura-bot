export const SAKURA_FORK_INFO: Readonly<{
  name: string
  version: string
  base: string
  channel: string
}>

export function analyzeDisconnect(error: any): {
  statusCode: number
  reasonName: string
  conflictType: string | null
  message: string
  retryable: boolean
  resetSession: boolean
  stop: boolean
  severity: string
  action: string
  diagnostics: any
}

export function resolveSakuraWaVersion(options?: {
  timeoutMs?: number
  logger?: any
}): Promise<{
  version: number[]
  source: string
  isLatest: boolean
  error?: any
}>

export function createSakuraCommandPoll(options?: {
  title?: string
  options?: string[]
  selectableCount?: number
}): {
  poll: {
    name: string
    values: string[]
    selectableCount: number
  }
}

export function createSakuraCommandList(options?: {
  title?: string
  body?: string
  footer?: string
  buttonText?: string
  responseMode?: 'legacy' | 'native'
  image?: Buffer | Uint8Array | object | null
  sections?: Array<{
    title?: string
    highlight_label?: string
    rows: Array<{
      header?: string
      title: string
      description?: string
      id?: string
      rowId?: string
    }>
  }>
}): any


export function createSakuraCopyCard(options?: {
  body?: string
  footer?: string
  buttonText?: string
  copyText?: string
}): any

export function parseSakuraNativeFlowResponse(paramsJson: string | object): string
export function extractSakuraSelection(message: any): string

export function makeSakuraSocket(config?: any): any
export default makeSakuraSocket


export function formatSakuraText(text?: unknown, options?: {
  title?: string
  icon?: string
  linePrefix?: string
  width?: number
}): string

export function buildSakuraMentionJids(metadata?: any, options?: {
  exclude?: string | string[]
}): string[]

export function patchSakuraInteractiveForMd(message?: any): any
export function getBizBinaryNode(message?: any): any
