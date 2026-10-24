#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let removed = 0
const targets = [path.join(root, 'config'), path.join(root, 'storage')]
for (const dir of targets) {
  if (!fs.existsSync(dir)) continue
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(?:db|sqlite)(?:-(?:wal|shm))?$/i.test(name) && !/\.test\.json$/i.test(name)) continue
    fs.rmSync(path.join(dir, name), { force: true })
    removed++
  }
}
console.log(`✅ Artefatos legados/teste removidos: ${removed}`)
