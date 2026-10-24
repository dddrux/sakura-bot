import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatMessage } from '../formatter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = rel => fs.existsSync(path.join(root, rel))
const config = JSON.parse(read('config/sakura.config.json'))
const pkg = JSON.parse(read('package.json'))

assert.match(pkg.version, /^2\.0\.0-rc\.(?:6|7|[89]|[1-9]\d+)$/)
assert.equal(config.bot.release, pkg.version)
assert.equal(config.paths.session, 'auth')
assert.ok(exists('auth/.gitkeep'))

assert.equal(config.ui.menuMedia, 'assets/menu/sakura-menu.mp4')
assert.equal(config.ui.menuMediaFps, 60)
assert.equal(config.ui.dividerEmoji, '🪷')
assert.deepEqual(config.ui.contentEmojis, ['💮', '🌸'])
assert.equal(config.economy.currencyEmoji, '🪙')
assert.ok(exists('assets/menu/sakura-menu.mp4'))

assert.deepEqual(config.ui.emojis, ['💮', '🌸', '💮'])
assert.ok(!config.ui.emojis.includes('🪷'), '🪷 não pode ser emoji de conteúdo legado')
assert.ok(!exists('storage/session'), 'sessão antiga storage/session não pode existir')
assert.ok(!exists('data/statusgp.json'), 'status de grupo deve usar o JSON central, não data/statusgp.json')
const groupStatusSource = read('commands/group-status.js')
assert.match(groupStatusSource, /openDatabase\(/, 'status de grupo deve usar o document store central')
assert.doesNotMatch(groupStatusSource, /statusgp\.json|DB_PATH/, 'status de grupo não pode manter banco JSON paralelo')
assert.ok(!exists('data/ai-crypto.js'), 'criptografia legada de token deve ser removida')
assert.doesNotMatch(read('install.sh'), /storage\/session/)
assert.doesNotMatch(read('data/scripts/preflight.js'), /storage\/session/)


assert.doesNotMatch(read('.env.example'), /SAKURA_AI_ENCRYPTION_KEY/, 'env legado não deve pedir chave de criptografia de token')
for (const legacyTest of ['data/scripts/test-v0357-ai.js', 'data/scripts/test-v0357-ui.js', 'data/scripts/test-part3.js']) {
  const source = read(legacyTest)
  assert.doesNotMatch(source, /SAKURA_AI_ENCRYPTION_KEY|ai-crypto|encryptToken|decryptToken|ciphertext|authTag/, `${legacyTest} ainda descreve o fluxo criptografado antigo`)
}

const buttonFiles = [
  ...fs.readdirSync(path.join(root, 'commands')).filter(name => name.endsWith('.js')).map(name => `commands/${name}`),
  ...fs.readdirSync(path.join(root, 'data')).filter(name => name.endsWith('.js')).map(name => `data/${name}`)
]
for (const file of buttonFiles) {
  const source = read(file)
  for (const match of source.matchAll(/buttonText:\s*['"`]([^'"`$]+)['"`]/g)) {
    const visible = String(match[1] || '').replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, '').trim()
    if (visible && /^[a-záàâãéêíóôõúç]/u.test(visible)) {
      assert.fail(`${file}: buttonText deve começar com maiúscula: ${match[1]}`)
    }
  }
}

const formatted = formatMessage('FRASE EXTREMAMENTE GIGANTE DESCONFIGURADA', { title: 'teste' })
assert.match(formatted, /^╭━━⪩ 🪷 \*TESTE\* ⪨━━/m)
assert.match(formatted, /▢ • 💮 FRASE EXTREMAMENTE GIGANTE DESCONFIGURADA/m)
assert.doesNotMatch(formatted, /▢ DESCONFIGURADA/m)
assert.match(formatted, /╰━━─「🪷」─━━$/m)
assert.doesNotMatch(formatted.split('\n').filter(line => line.startsWith('▢')).join('\n'), /🪷/)

const interactive = read('data/interactive.js')
assert.match(interactive, /export async function getMenuMedia/)
assert.match(interactive, /videoMessage/)
assert.match(interactive, /prepareWAMessageMedia\(\s*\{ video:/)
assert.match(interactive, /buttonText = '💮 Abrir lista'/)

const stickerDelivery = read('data/media-delivery.js')
assert.match(stickerDelivery, /sendStickerMedia/)
assert.match(stickerDelivery, /sendAudioFileMedia/)
assert.match(stickerDelivery, /Buffer\.isBuffer/)
assert.doesNotMatch(stickerDelivery, /VER CANAL DA SAKURA|sendOfficialLinksBar/)

for (const command of ['commands/s.js', 'commands/take.js']) {
  const source = read(command)
  assert.match(source, /sendStickerMedia/)
  assert.doesNotMatch(source, /Sakura-MD • Drux Domina/)
}
const play = read('commands/play.js')
assert.match(play, /sendAudioMedia/)
assert.match(play, /fs\.readFile\(media\.filePath\)/, '.play deve enviar Buffer estável antes de limpar o temporário')

const tokens = read('commands/ai-tokens.js')
assert.match(tokens, /writeConfigSync/)
assert.match(tokens, /token atribuido!/i)
assert.doesNotMatch(tokens, /ai-crypto|encryptToken|decryptToken|SAKURA_AI_ENCRYPTION_KEY/)
const engine = read('data/ai-engine.js')
assert.doesNotMatch(engine, /decryptToken|encryptionKeyStatus|selectAiToken|countAiTokensForChat/)
assert.match(engine, /tryLocalCommandHelp/)
assert.doesNotMatch(engine, /buildAiQuickReplies/, 'IA normal não deve anexar quick replies soltos')
assert.ok(exists('data/ai-command-guide.js'))
assert.ok(exists('commands/ai-config.js'))
assert.match(read('commands/ai-config.js'), /name:\s*'iaconfig'/)
assert.match(read('commands/ai-config.js'), /subownerAllowed:\s*true/)
assert.match(read('commands/ai-config.js'), /Opções da IA/i)

assert.ok(exists('commands/diagnostic.js'))
const configCommand = read('commands/config.js')
for (const label of ['Inteligência artificial', 'Aparência e links', 'VIP e doações', 'Economia', 'Grupos e recepção', 'Mídia e AutoFig', 'Sistema']) assert.match(configCommand, new RegExp(label, 'i'))
assert.match(configCommand, /diagnostico/)

assert.ok(Array.isArray(config.ai.tokens))
assert.ok(config.ai.tokens.every(item => typeof item === 'string' || typeof item?.token === 'string'))
assert.equal(config.bot.codename, 'Hanami')
assert.match(read('commands/info.js'), /Hanami/)
assert.doesNotMatch(read('commands/info.js'), /Projeto:\*?\s*Drux Domina/i)
assert.match(read('commands/rentals.js'), /groupDisplayName/)


assert.match(read('commands/diagnostic.js'), /menuMediaPath/, 'diagnóstico deve exibir o caminho real da mídia de menu')
assert.doesNotMatch(read('commands/diagnostic.js'), /settings\.menuMedia\s*\|\|\s*settings\.menuImage/, 'diagnóstico usa propriedades antigas inexistentes')
assert.match(read('commands/s.js'), /groupDisplayName/, 'commands/s.js deve resolver o nome real do grupo na descrição da figurinha')
assert.match(read('commands/take.js'), /stripStickerMetadata/, 'commands/take.js deve limpar metadados antigos')

assert.ok(Array.isArray(config.vip.plans) && config.vip.plans.length >= 3)
assert.ok(config.vip.plans.every(plan => Number(plan.price) < 15))


const vipRuntime = read('data/vip.js')
assert.match(vipRuntime, /getVipBenefits/, 'benefícios VIP por plano precisam de resolvedor runtime')
assert.match(read('commands/play.js'), /getVipBenefits/, '.play deve usar o limite do plano VIP real')
assert.doesNotMatch(read('commands/play.js'), /vip\s*\?\s*95\s*:\s*48/, '.play não pode usar teto VIP hardcoded')
assert.match(read('commands/economy.js'), /dailyMultiplier/, 'economia deve receber multiplicador diário do plano')
assert.match(read('commands/economy.js'), /workMultiplier/, 'economia deve receber multiplicador de trabalho do plano')
for (const mediaFile of ['commands/tiktok.js', 'commands/social-download.js', 'commands/media-tools.js', 'commands/s20.js', 'commands/figvip.js', 'data/group-automations.js']) {
  assert.match(read(mediaFile), /getVipBenefits/, `${mediaFile} deve respeitar limite/prioridade do plano VIP`)
}
assert.doesNotMatch(read('commands/vip.js'), /\+50% diário e \+20% trabalho/, 'painel VIP não pode anunciar benefício fixo para todos os planos')
assert.deepEqual(config.vip.plans.map(plan => plan.key), ['bloom', 'prime', 'hanami'])
assert.equal(config.donation.pix, '5581999434137')
assert.equal(config.donation.name, 'Manassés Matheus de Souza Santana')
assert.ok(exists('commands/donation.js'))
assert.match(read('commands/donation.js'), /cta_copy|copy/i)
assert.match(read('commands/donation.js'), /5581999434137/)

const menu = read('data/interactive.js')
assert.doesNotMatch(menu, /comandos organizados por/i)
assert.match(menu, /Opções da IA/)

console.log('✅ RC6 mega: menu em vídeo, formatter, mídia, IA, VIP/doação, grupos e auth aprovados')
