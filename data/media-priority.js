import { settings } from './settings.js'
import { PriorityScheduler } from './priority-scheduler.js'

const scheduler = new PriorityScheduler({
  concurrency: settings.mediaConcurrency || 3,
  vipBurst: settings.vipBurst || 3,
  maxPending: Math.max(100, settings.maxPendingMessages || 1200)
})

export function enqueueMediaTask(task, { vip = false, priority = '' } = {}) {
  return scheduler.enqueue(task, { priority: priority || (vip ? 'vip' : 'normal'), metadata: { media: true, vip: Boolean(vip) } })
}

export function mediaQueueSnapshot() {
  return scheduler.snapshot()
}
