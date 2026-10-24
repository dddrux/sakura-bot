import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LoginRateLimiter, panelSecurityHeaders, removeInitialPanelPassword, writeInitialPanelPassword } from '../panel-security.js'

const limiter = new LoginRateLimiter({ maxFailures: 3, windowMs: 1_000, blockMs: 2_000, maxTrackedClients: 10 })
assert.equal(limiter.status('ip', 100).allowed, true)
assert.equal(limiter.failure('ip', 100).allowed, true)
assert.equal(limiter.failure('ip', 200).allowed, true)
const blocked = limiter.failure('ip', 300)
assert.equal(blocked.allowed, false)
assert.equal(blocked.remainingMs, 2_000)
assert.equal(limiter.status('ip', 2_301).allowed, true)
limiter.success('ip')
assert.equal(limiter.status('ip', 2_302).failures, 0)

const headers = panelSecurityHeaders('text/html; charset=utf-8')
assert.equal(headers['x-frame-options'], 'DENY')
assert.match(headers['content-security-policy'], /frame-ancestors 'none'/)
assert.equal(headers['x-content-type-options'], 'nosniff')

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-panel-'))
const credential = path.join(directory, 'private', 'initial.txt')
await writeInitialPanelPassword(credential, 'segredo-de-teste')
const stat = await fs.stat(credential)
if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600)
assert.match(await fs.readFile(credential, 'utf8'), /segredo-de-teste/)
await removeInitialPanelPassword(credential)
await assert.rejects(fs.stat(credential))
await fs.rm(directory, { recursive: true, force: true })

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const panelSource = await fs.readFile(path.join(root, 'data', 'panel.js'), 'utf8')
assert(!/console\.log\([\s\S]{0,120}senha temporária/i.test(panelSource), 'senha temporária ainda aparece no terminal')
assert.match(panelSource, /LoginRateLimiter/)
assert.match(panelSource, /sessionStorage\.sakuraToken/)
const clientSource = await fs.readFile(path.join(root, 'data', 'client.js'), 'utf8')
assert.match(clientSource, /encerramento seguro iniciado/)
assert.match(clientSource, /process\.once\('uncaughtException'/)
assert.match(clientSource, /await releaseSessionLock\(\)/)

const previewSource = await fs.readFile(path.join(root, 'data', 'vendor', 'sakura-baileys', 'lib', 'Utils', 'link-preview.js'), 'utf8')
assert.match(previewSource, /function parsePreview/)
assert.doesNotMatch(previewSource, /import\('link-preview-js'\)/)

console.log('✅ v1.0.0: painel limitado, segredo privado 0600, cabeçalhos, encerramento e prévia interna aprovados')
