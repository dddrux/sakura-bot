export class FairSemaphore {
  constructor(limit = 1) {
    this.limit = Math.max(1, Number(limit) || 1)
    this.active = 0
    this.waiters = []
  }

  acquire() {
    return new Promise(resolve => {
      const grant = () => {
        this.active += 1
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active = Math.max(0, this.active - 1)
          this.#pump()
        })
      }
      this.waiters.push(grant)
      this.#pump()
    })
  }

  #pump() {
    while (this.active < this.limit && this.waiters.length) {
      const next = this.waiters.shift()
      next()
    }
  }

  snapshot() {
    return { limit: this.limit, active: this.active, waiting: this.waiters.length }
  }
}
