import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-reception-'))
process.env.SAKURA_DB_FILE = path.join(temp, 'db.json')

const reception = await import('../reception.js')
const chat = '120363000000000000@g.us'
const number = '5581999999999'

assert.equal(typeof reception.buildReceptionModel, 'function', 'falta buildReceptionModel')
assert.equal(typeof reception.validateReceptionProfile, 'function', 'falta validateReceptionProfile')
assert.equal(typeof reception.markReceptionPending, 'function', 'falta markReceptionPending')
assert.equal(typeof reception.getReceptionGate, 'function', 'falta getReceptionGate')
assert.equal(typeof reception.approveReceptionMember, 'function', 'falta approveReceptionMember')

await reception.setReceptionConfig(chat, { enabled: true, fields: ['nome', 'idade', 'cidade'] })
const cfg = await reception.getReceptionConfig(chat)
const model = reception.buildReceptionModel(cfg, '.')
assert.equal(model, '.ficha Seu nome | Sua idade | Sua cidade')
assert.equal(reception.validateReceptionProfile({ nome: 'Drux', idade: '17', cidade: 'Recife' }, cfg).valid, true)
assert.equal(reception.validateReceptionProfile({ nome: 'Drux', idade: '', cidade: 'Recife' }, cfg).valid, false)
assert.equal(reception.validateReceptionProfile({ nome: 'Drux', idade: 'abc', cidade: 'Recife' }, cfg).valid, false)

await reception.markReceptionPending(chat, number, { source: 'join' })
let gate = await reception.getReceptionGate(chat, number)
assert.equal(gate.enabled, true)
assert.equal(gate.pending, true)
await reception.approveReceptionMember(chat, number)
gate = await reception.getReceptionGate(chat, number)
assert.equal(gate.pending, false)
assert.equal(gate.approved, true)

const groupAutomations = await fs.readFile(new URL('../group-automations.js', import.meta.url), 'utf8')
assert.match(groupAutomations, /createSakuraCopyCard/, 'recepção de entrada não usa cartão copiável')
assert.match(groupAutomations, /🌸 Copiar modelo/, 'botão copiar modelo ausente')
assert.match(groupAutomations, /markReceptionPending/, 'entrada não marca membro como pendente')

const handler = await fs.readFile(new URL('../handler.js', import.meta.url), 'utf8')
assert.match(handler, /getReceptionGate/, 'handler não consulta a catraca da recepção')
assert.match(handler, /RECEPÇÃO PENDENTE/, 'handler não avisa sobre ficha pendente')
assert.match(handler, /🌸 Copiar modelo/, 'bloqueio não oferece modelo copiável')

const stickerCommand = await fs.readFile(new URL('../../commands/sticker-convert.js', import.meta.url), 'utf8')
const stickerHelper = await fs.readFile(new URL('../sticker-convert.js', import.meta.url), 'utf8').catch(() => '')
assert.match(stickerCommand, /convertStickerToImage/, '.toimg não usa helper robusto')
assert.match(stickerCommand, /convertStickerToVideo/, '.tomp4 não usa helper robusto')
assert.match(stickerHelper, /Jimp|jimp/, 'conversão de imagem não tem caminho sem FFmpeg')
assert.match(stickerHelper, /libx264/, 'conversão de vídeo não tenta H.264')
assert.match(stickerHelper, /mpeg4/, 'conversão de vídeo não tem fallback MPEG-4')

await fs.rm(temp, { recursive: true, force: true })
console.log('✅ RC11 recepção: catraca, modelo copiável e conversores resilientes especificados')
