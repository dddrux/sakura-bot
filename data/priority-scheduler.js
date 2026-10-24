export class PriorityScheduler {
  constructor({ concurrency = 2, vipBurst = 3, maxPending = 1000 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1)
    this.vipBurst = Math.max(1, Number(vipBurst) || 1)
    this.maxPending = Math.max(10, Number(maxPending) || 1000)
    this.queues = { vip: [], high: [], normal: [], low: [] }
    this.active = 0
    this.vipRun = 0
    this.sequence = 0
  }

  enqueue(task, { priority = 'normal', metadata = {} } = {}) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('Tarefa inválida.'))
    if (this.pending >= this.maxPending) return Promise.reject(Object.assign(new Error('Fila de prioridade cheia.'), { code: 'PRIORITY_QUEUE_FULL' }))
    const key = ['vip', 'high', 'normal', 'low'].includes(priority) ? priority : 'normal'
    return new Promise((resolve, reject) => {
      this.queues[key].push({ task, resolve, reject, priority: key, metadata, enqueuedAt: Date.now(), sequence: ++this.sequence })
      this.#pump()
    })
  }

  #next() {
    const { vip, high, normal, low } = this.queues
    const nonVip = high.length || normal.length || low.length
    if (vip.length && (!nonVip || this.vipRun < this.vipBurst)) { this.vipRun += 1; return vip.shift() }
    if (high.length) { this.vipRun = 0; return high.shift() }
    if (normal.length) { this.vipRun = 0; return normal.shift() }
    if (low.length) { this.vipRun = 0; return low.shift() }
    if (vip.length) { this.vipRun = 1; return vip.shift() }
    return null
  }

  #pump() {
    while (this.active < this.concurrency) {
      const job = this.#next()
      if (!job) return
      this.active += 1
      Promise.resolve().then(() => job.task({ queueWaitMs: Date.now() - job.enqueuedAt, priority: job.priority, metadata: job.metadata, snapshot: this.snapshot() }))
        .then(job.resolve, job.reject)
        .finally(() => { this.active = Math.max(0, this.active - 1); this.#pump() })
    }
  }

  get pending() { return Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0) }
  snapshot() { return { active: this.active, pending: this.pending, concurrency: this.concurrency, vipBurst: this.vipBurst, vip: this.queues.vip.length, high: this.queues.high.length, normal: this.queues.normal.length, low: this.queues.low.length } }
}
