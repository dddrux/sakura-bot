import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const config = JSON.parse(read('config/sakura.config.json'))

assert.equal(config.bot.release, '2.0.0-rc.11', 'release finalization must be rc.11')
assert.equal(config.economy.currencyName, 'Sakura Coins')
assert.equal(config.economy.currencyEmoji, '🪙')
assert.ok(config.reception && typeof config.reception === 'object', 'reception config missing')
assert.ok(config.games && typeof config.games === 'object', 'games config missing')
assert.ok(config.queues?.mediaConcurrency >= 2, 'media concurrency config missing')
assert.ok(config.queues?.vipBurst >= 1, 'VIP burst setting missing')

const commandFiles = fs.readdirSync(path.join(root, 'commands')).filter(name => name.endsWith('.js'))
assert.ok(commandFiles.length >= 45, 'command catalog unexpectedly small')
for (const file of commandFiles) {
  const source = read(`commands/${file}`)
  assert.match(source, /defineCommand\s*\(/, `${file} is not using defineCommand()`)
  assert.doesNotMatch(source, /export\s+default\s+\{/, `${file} still exports a legacy object`)
}

function runtimeJsFiles(dir) {
  const base = path.join(root, dir)
  const out = []
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ['vendor', 'scripts'].includes(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(path.relative(root, full))
    }
  }
  walk(base)
  return out
}
for (const file of [...runtimeJsFiles('commands'), ...runtimeJsFiles('data')]) {
  let allowed = /[🌸🪷💮🪙🍥💎]/gu
  if (['data/official-links.js', 'data/interactive.js', 'commands/menu.js'].includes(file)) allowed = /[🌸🪷💮🪙🍥🔗💎]/gu
  if (['data/sticker-metadata.js', 'data/triggers.js'].includes(file)) allowed = /[🌸🪷💮🪙🍥❄️💎🧊]/gu
  if (file === 'data/ranking-format.js') allowed = /[🌸🪷💮🪙🍥💎🥇🥈🥉]/gu
  if (file === 'commands/tarot.js') allowed = /[🌸🪷💮🪙🍥💎⭐]/gu
  // Economy items intentionally use representative emojis instead of the Sakura palette.
  // Keep the old palette guard everywhere else so this exception stays scoped to economy data.
  if (file === 'data/economy.js') allowed = /[🌸🪷💮🪙🍥💎🛡️🍵🍀🎟️🗝️🌹🪵🎀✨🪨⚙️]/gu
  if (file === 'data/economy-part3.js') allowed = /[🌸🪷💮🪙🍥💎🐾🦊🐧🐉🚫🛖🏠🏡🏰]/gu
  const runtimeSource = read(file).replace(allowed, '')
  assert.doesNotMatch(runtimeSource, /\p{Extended_Pictographic}/u, `${file} still contains non-Sakura pictographic emoji`)
}

const vipAsset = path.join(root, 'assets/menu/sakura-vip-menu.png')
assert.ok(fs.existsSync(vipAsset), 'VIP menu placeholder asset missing')
assert.ok(fs.statSync(vipAsset).size > 1024, 'VIP menu asset is too small')

const { PriorityScheduler } = await import(pathToFileURL(path.join(root, 'data/priority-scheduler.js')).href)
const scheduler = new PriorityScheduler({ concurrency: 1, vipBurst: 2 })
const order = []
let releaseFirst
const first = scheduler.enqueue(() => new Promise(resolve => { releaseFirst = () => { order.push('normal-1'); resolve() } }), { priority: 'normal' })
await new Promise(resolve => setTimeout(resolve, 5))
const normal2 = scheduler.enqueue(async () => { order.push('normal-2') }, { priority: 'normal' })
const vip1 = scheduler.enqueue(async () => { order.push('vip-1') }, { priority: 'vip' })
const vip2 = scheduler.enqueue(async () => { order.push('vip-2') }, { priority: 'vip' })
releaseFirst()
await Promise.all([first, normal2, vip1, vip2])
assert.deepEqual(order, ['normal-1', 'vip-1', 'vip-2', 'normal-2'], 'VIP queue priority is not working')

const { createGame, playMove, renderBoardPng } = await import(pathToFileURL(path.join(root, 'data/tictactoe.js')).href)
let game = createGame({ chat: 'test@g.us', x: '111', o: '222' })
game = playMove(game, '111', 0)
game = playMove(game, '222', 3)
game = playMove(game, '111', 1)
game = playMove(game, '222', 4)
game = playMove(game, '111', 2)
assert.equal(game.winner, '111', 'tic-tac-toe winner detection failed')
const png = renderBoardPng(game)
assert.ok(Buffer.isBuffer(png))
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'tic-tac-toe renderer is not PNG')
assert.ok(png.length > 2000, 'tic-tac-toe image is unexpectedly small')

const { defaultReceptionConfig, formatReceptionCard } = await import(pathToFileURL(path.join(root, 'data/reception.js')).href)
const reception = defaultReceptionConfig('test@g.us')
assert.ok(reception.fields.includes('nome'))
assert.ok(reception.fields.includes('idade'))
const card = formatReceptionCard({ name: 'Sakura', age: '18', city: 'Recife' }, reception)
assert.match(card, /🌸/)
assert.match(card, /Sakura/)

const figVipSource = read('commands/figvip.js')
assert.match(figVipSource, /vipOnly:\s*true/, 'figvip must declare vipOnly in the V2 command contract')
assert.match(figVipSource, /priority:\s*['"]vip['"]/, 'figvip must declare VIP priority')

const interactiveSource = read('data/interactive.js')
assert.match(interactiveSource, /['"]VIP['"]/, 'VIP category missing from the V2 menu catalog')
assert.match(interactiveSource, /Inteligência artificial/, 'AI category missing from the V2 menu catalog')
assert.match(interactiveSource, /Configuração/, 'configuration category missing from the V2 menu catalog')
assert.match(interactiveSource, /Diversão/, 'fun category missing from the V2 menu catalog')
assert.doesNotMatch(read('commands/group-schedule.js'), /category:\s*['"]Admin['"]/, 'legacy Admin category must be normalized')

const commandUiStateSource = read('data/command-ui-state.js')
assert.match(commandUiStateSource, /markCommandCta/, 'command CTA state tracker missing')
assert.match(commandUiStateSource, /consumeCommandCta/, 'command CTA consumption missing')
const handlerSource = read('data/handler.js')
assert.match(handlerSource, /command\.officialLinks\s*===\s*true/, 'handler deve tratar links oficiais como opt-in')
assert.doesNotMatch(handlerSource, /sendOfficialLinksBar/, 'handler não pode anexar CTA oficial depois de comandos comuns')
assert.match(handlerSource, /withSendPriority/, 'handler must bind command priority to message sender')

const sendManagerSource = read('data/send-manager.js')
assert.match(sendManagerSource, /export\s+async\s+function\s+sendMessageFast/, 'fast message manager missing')
const replySource = read('data/reply.js')
assert.match(replySource, /sendMessageFast/, 'reply() is not using the fast message manager')
const workstationSource = read('data/workstation.js')
assert.match(workstationSource, /sendMessageFast/, 'workstation context must expose fast sending')

const vipSource = read('data/vip.js')
assert.match(vipSource, /settings\.vipMediaLimitMb/)
assert.match(vipSource, /settings\.freeMediaLimitMb/)
assert.match(vipSource, /settings\.currencyName|settings\.vipPriorityMultiplier/)

assert.ok(fs.existsSync(path.join(root, 'commands/reception.js')), 'reception command missing')
assert.ok(fs.existsSync(path.join(root, 'commands/tictactoe.js')), 'tic-tac-toe command missing')
assert.ok(fs.existsSync(path.join(root, 'commands/group-customization.js')), 'group customization command missing')
assert.ok(fs.existsSync(path.join(root, 'commands/media-tools.js')), 'media tools command missing')

console.log('✅ Sakura V2 finalization contracts passed')
