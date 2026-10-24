import { FairSemaphore } from '../semaphore.js'
import { TriggerDispatcher } from '../trigger-dispatcher.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const semaphore = new FairSemaphore(2)
let active = 0
let maxActive = 0
const order = []
await Promise.all(Array.from({ length: 6 }, (_, index) => (async () => {
  const release = await semaphore.acquire()
  active += 1
  maxActive = Math.max(maxActive, active)
  order.push(index)
  await sleep(5)
  active -= 1
  release()
})()))
if (maxActive !== 2) throw new Error(`Semáforo não respeitou limite: ${maxActive}`)
if (order.join(',') !== '0,1,2,3,4,5') throw new Error(`Semáforo perdeu FIFO: ${order.join(',')}`)

const dispatcher = new TriggerDispatcher({ concurrency: 2, maxPerChat: 5 })
const events = []
let mediaActive = 0
let mediaMax = 0
const jobs = [
  ['grupo-a', 'a1', 20],
  ['grupo-a', 'a2', 1],
  ['grupo-b', 'b1', 5],
  ['grupo-c', 'c1', 5]
].map(([chat, label, delay]) => dispatcher.enqueue(chat, async () => {
  mediaActive += 1
  mediaMax = Math.max(mediaMax, mediaActive)
  events.push(`start:${label}`)
  await sleep(delay)
  events.push(`end:${label}`)
  mediaActive -= 1
}))
await Promise.all(jobs)
if (mediaMax > 2) throw new Error(`Dispatcher excedeu concorrência: ${mediaMax}`)
if (events.indexOf('start:a2') < events.indexOf('end:a1')) throw new Error(`Ordem por grupo foi quebrada: ${events.join(',')}`)
if (events.indexOf('start:b1') > events.indexOf('start:a2')) throw new Error(`Outro grupo não recebeu prioridade justa: ${events.join(',')}`)

console.log(`✅ Estabilidade: limite global, FIFO e distribuição justa por grupo aprovados (${events.join(' → ')})`)
