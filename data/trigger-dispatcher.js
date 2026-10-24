import { settings } from './settings.js'

export class TriggerDispatcher {
  constructor({ concurrency = 3, maxPerChat = 6 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1)
    this.maxPerChat = Math.max(1, Number(maxPerChat) || 1)
    this.pending = new Map()
    this.readyChats = []
    this.readySet = new Set()
    this.activeChats = new Set()
    this.active = 0
    this.totalQueued = 0
  }

  enqueue(chat, task, metadata = {}) {
    const key = String(chat || 'unknown')
    const queue = this.pending.get(key) || []
    if (queue.length >= this.maxPerChat) {
      const dropped = queue.shift()
      this.totalQueued = Math.max(0, this.totalQueued - 1)
      dropped?.reject?.(Object.assign(new Error('Fila de mídia automática cheia para este chat.'), { code: 'AUTO_MEDIA_QUEUE_FULL' }))
    }

    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject, metadata, enqueuedAt: Date.now() })
      this.pending.set(key, queue)
      this.totalQueued += 1
      this.#markReady(key)
      this.#pump()
    })
  }

  #markReady(chat) {
    if (this.activeChats.has(chat) || this.readySet.has(chat)) return
    if (!(this.pending.get(chat)?.length)) return
    this.readySet.add(chat)
    this.readyChats.push(chat)
  }

  #nextChat() {
    while (this.readyChats.length) {
      const chat = this.readyChats.shift()
      this.readySet.delete(chat)
      if (this.activeChats.has(chat)) continue
      if (!(this.pending.get(chat)?.length)) continue
      return chat
    }
    return null
  }

  #pump() {
    while (this.active < this.concurrency) {
      const chat = this.#nextChat()
      if (!chat) return
      const queue = this.pending.get(chat)
      const job = queue?.shift()
      if (!job) continue
      this.totalQueued = Math.max(0, this.totalQueued - 1)
      if (!queue.length) this.pending.delete(chat)
      this.active += 1
      this.activeChats.add(chat)

      Promise.resolve()
        .then(() => job.task({
          queueWaitMs: Date.now() - job.enqueuedAt,
          snapshot: this.snapshot(),
          metadata: job.metadata
        }))
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active = Math.max(0, this.active - 1)
          this.activeChats.delete(chat)
          this.#markReady(chat)
          this.#pump()
        })
    }
  }

  snapshot() {
    return {
      concurrency: this.concurrency,
      active: this.active,
      queued: this.totalQueued,
      chats: this.pending.size,
      activeChats: this.activeChats.size
    }
  }
}

export const triggerDispatcher = new TriggerDispatcher({
  concurrency: settings.autoMediaConcurrency,
  maxPerChat: settings.autoMediaQueuePerChat
})
