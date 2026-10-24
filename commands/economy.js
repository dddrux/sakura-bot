import { defineCommand } from '../data/workstation.js'
import { cachedProfilePicture } from '../data/cache.js'
import { getDevice } from '@sakura-md/baileys'
import fs from 'node:fs/promises'
import { sendCommandResult } from '../data/fun-media-store.js'
import {
  beginTransfer,
  bet,
  buyItem,
  cancelTransfer,
  claimDailyBox,
  claimMission,
  claimYield,
  confirmTransfer,
  convertGold,
  craftItem,
  daily,
  deposit,
  economyAction,
  getAchievements,
  getAccount,
  getInventory,
  getMiningStatus,
  getMissions,
  getGroupEconomyStatus,
  getStatement,
  mineGold,
  register,
  rob,
  sellItem,
  setGroupEconomyLimit,
  setJob,
  upgradePickaxe,
  useItem,
  withdraw,
  work
} from '../data/economy.js'
import {
  acceptTradeOffer,
  addShopListing,
  buyFromUserShop,
  buyHouse,
  buyPet,
  claimInvestment,
  closeTradeOffer,
  createTradeOffer,
  createUserShop,
  evolvePet,
  getHouse,
  getPart3Account,
  getPets,
  getUserShop,
  listInvestments,
  listTradeOffers,
  removeShopListing,
  setActivePet,
  sleepAtHome,
  startInvestment
} from '../data/economy-part3.js'
import {
  duration,
  money,
  sendAchievements,
  sendBalance,
  sendBank,
  sendEconomyHub,
  sendDailyBoxPanel,
  sendInventory,
  sendJobs,
  sendJourney,
  sendMiningPanel,
  sendMissions,
  sendPickaxePanel,
  sendProfile,
  sendRoutine,
  sendShop,
  sendStatement,
  sendTransferConfirmation,
  sendWorkshop,
  shortNumber
} from '../data/economy-ui.js'
import {
  sendGroupEconomyPanel,
  sendHousePanel,
  sendInvestmentPanel,
  sendOffersPanel,
  sendPetsPanel,
  sendUserShopPanel
} from '../data/economy-part3-ui.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { reply } from '../data/reply.js'
import { getVipBenefits, isVip } from '../data/vip.js'
import { groupNameMap, displayUser } from '../data/user-display.js'
import { rememberUser } from '../data/core-store.js'

const numberValue = value => {
  const raw = String(value || '').trim()
  if (!/^\d{1,15}$/.test(raw)) return 0
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function usedCommand(text, prefix) {
  return normalize(String(text || '').slice(prefix.length).trim().split(/\s+/, 1)[0])
}

function targetNumber(msg, args = []) {
  const context = getContextInfo(msg.message)
  const mention = firstTargetJid(msg, args)
  return String(mention).replace(/\D/g, '') || String(args[0] || '').replace(/\D/g, '')
}

async function resolveProfileTarget(sock, msg, args = [], senderNumber = '') {
  const context = getContextInfo(msg.message)
  let jid = firstTargetJid(msg, args)
  let number = String(jid || args[0] || senderNumber).replace(/\D/g, '')

  if (jid && String(jid).includes('@lid') && typeof sock.sakuraResolveNumber === 'function') {
    try {
      const resolved = await sock.sakuraResolveNumber(jid)
      if (resolved) number = String(resolved).replace(/\D/g, '')
    } catch {}
  }

  if (!jid && number) jid = `${number}@s.whatsapp.net`
  if (!jid) jid = msg.key.participant || msg.key.remoteJid
  if (!number && typeof sock.sakuraResolveNumber === 'function') {
    try {
      const resolved = await sock.sakuraResolveNumber(jid)
      number = String(resolved || jid).replace(/\D/g, '')
    } catch {
      number = String(jid || '').replace(/\D/g, '')
    }
  }
  if (!number) number = String(senderNumber || '').replace(/\D/g, '')
  return { jid, number }
}

async function getProfileImage(sock, jid, number, logger) {
  const candidates = [...new Set([jid, number ? `${number}@s.whatsapp.net` : ''].filter(Boolean))]
  for (const target of candidates) {
    try {
      const url = await cachedProfilePicture(sock, target, 'image')
      if (!url) continue
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length) return { buffer, url }
    } catch (error) {
      logger?.debug?.({ error, stage: 'profile-photo', target: String(target).replace(/\d(?=\d{4})/g, '*') }, 'foto de perfil indisponível')
    }
  }
  return null
}

function appendUnlocked(text, unlocked = []) {
  if (!unlocked?.length) return text
  return `${text}\n\n🌸 *memória rara:* ${unlocked.map(item => item.name).join(', ')}`
}

function appendGroupLimit(text, result) {
  if (!result?.limited) return text
  return `${text}\n\n💮 *limite do grupo:* a recompensa em Sakura Coins foi reduzida porque a emissão diária está próxima do limite.`
}

async function simpleResult(sock, msg, text, extra = {}) {
  return reply(sock, msg, text, { title: 'JARDIM SAKURA', icon: '💮', ...extra })
}

async function economyMediaResult(sock, msg, command, text, category = 'sucesso') {
  return sendCommandResult({ sock, msg, command, caption: text, category })
}


const menuEntries = [
  { name: 'eco', usage: '.eco', description: 'Abre o Jardim de Sakura Coins.', menuGroup: 'Jardim' },
  { name: 'registrar', usage: '.registrar', description: 'Cria ou confirma sua conta Sakura.', menuGroup: 'Conta' },
  { name: 'saldo', usage: '.saldo', description: 'Mostra carteira, cofre, nível e progresso.', menuGroup: 'Conta' },
  { name: 'perfil', usage: '.perfil [@pessoa]', description: 'Mostra celular, foto e conta da pessoa. Atalho: .pf', menuGroup: 'Conta' },
  { name: 'extrato', usage: '.extrato', description: 'Mostra as transações recentes da conta.', menuGroup: 'Conta' },
  { name: 'conquistas', usage: '.conquistas', description: 'Mostra memórias raras e conquistas.', menuGroup: 'Conta' },
  { name: 'rotina', usage: '.rotina', description: 'Abre as ações rápidas do dia.', menuGroup: 'Rotina' },
  { name: 'diario', usage: '.diario', description: 'Colhe a recompensa diária.', menuGroup: 'Rotina' },
  { name: 'caixadiaria', usage: '.caixadiaria', description: 'Abre uma caixa de Sakura Coins, ouro e materiais.', menuGroup: 'Rotina' },
  { name: 'oficio', usage: '.oficio', description: 'Escolhe sua ocupação no Jardim.', menuGroup: 'Rotina' },
  { name: 'trabalhar', usage: '.trabalhar', description: 'Realiza um turno no ofício atual.', menuGroup: 'Rotina' },
  { name: 'missao', usage: '.missao', description: 'Mostra e coleta as Estrelas do Dia.', menuGroup: 'Rotina' },
  { name: 'jornada', usage: '.jornada', description: 'Abre os caminhos de exploração.', menuGroup: 'Jornadas' },
  { name: 'minerar', usage: '.minerar', description: 'Minera ouro usando sua picareta.', menuGroup: 'Mineração' },
  { name: 'ouro', usage: '.ouro', description: 'Mostra ouro, cotação e estatísticas de mineração.', menuGroup: 'Mineração' },
  { name: 'trocarouro', usage: '.trocarouro 50', description: 'Converte ouro em Sakura Coins.', menuGroup: 'Mineração' },
  { name: 'picareta', usage: '.picareta', description: 'Mostra sua picareta e a progressão.', menuGroup: 'Mineração' },
  { name: 'melhorarpicareta', usage: '.melhorarpicareta', description: 'Melhora a picareta de forma atômica.', menuGroup: 'Mineração' },
  { name: 'pescar', usage: '.pescar', description: 'Visita o Lago Lunar.', menuGroup: 'Jornadas' },
  { name: 'explorar', usage: '.explorar', description: 'Percorre a Trilha Sakura.', menuGroup: 'Jornadas' },
  { name: 'jardim', usage: '.jardim', description: 'Cuida do Jardim Secreto.', menuGroup: 'Jornadas' },
  { name: 'crime', usage: '.crime', description: 'Tenta a Rota Sombria com risco.', menuGroup: 'Jornadas' },
  { name: 'banco', usage: '.banco', description: 'Abre o Cofre Sakura.', menuGroup: 'Banco e PIX' },
  { name: 'depositar', usage: '.depositar 500', description: 'Guarda Sakura Coins da carteira no cofre.', menuGroup: 'Banco e PIX' },
  { name: 'sacar', usage: '.sacar 500', description: 'Retira Sakura Coins do cofre.', menuGroup: 'Banco e PIX' },
  { name: 'rendimento', usage: '.rendimento', description: 'Colhe o rendimento diário do cofre.', menuGroup: 'Banco e PIX' },
  { name: 'pix', usage: '.pix @pessoa 500', description: 'Prepara uma transferência com confirmação.', menuGroup: 'Banco e PIX' },
  { name: 'investir', usage: '.investir conservador 500', description: 'Cria investimentos com prazo e risco controlado.', menuGroup: 'Investimentos' },
  { name: 'investimentos', usage: '.investimentos', description: 'Mostra investimentos ativos e resgates.', menuGroup: 'Investimentos' },
  { name: 'ofertar', usage: '.ofertar @pessoa item 1 500', description: 'Cria uma oferta reservada para outro membro.', menuGroup: 'Comércio' },
  { name: 'ofertas', usage: '.ofertas', description: 'Mostra ofertas pendentes do grupo.', menuGroup: 'Comércio' },
  { name: 'minhaloja', usage: '.minhaloja', description: 'Abre sua loja e anúncios.', menuGroup: 'Comércio' },
  { name: 'criarloja', usage: '.criarloja Nome', description: 'Cria ou renomeia sua loja.', menuGroup: 'Comércio' },
  { name: 'anunciar', usage: '.anunciar item 1 500', description: 'Reserva itens da mochila em sua loja.', menuGroup: 'Comércio' },
  { name: 'lojade', usage: '.lojade @pessoa', description: 'Consulta a loja de outro membro.', menuGroup: 'Comércio' },
  { name: 'pets', usage: '.pets', description: 'Abre o catálogo e sua coleção de pets.', menuGroup: 'Pets e Casas' },
  { name: 'comprarpet', usage: '.comprarpet kitsune', description: 'Compra um pet do catálogo.', menuGroup: 'Pets e Casas' },
  { name: 'casa', usage: '.casa', description: 'Mostra sua casa e melhorias.', menuGroup: 'Pets e Casas' },
  { name: 'dormir', usage: '.dormir', description: 'Descansa e reduz cooldowns de forma limitada.', menuGroup: 'Pets e Casas' },
  { name: 'economiagrupo', usage: '.economiagrupo', description: 'Mostra circulação e limite diário de Sakura Coins.', menuGroup: 'Administração econômica' },
  { name: 'loja', usage: '.loja', description: 'Abre a Vitrine Sakura.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'comprar', usage: '.comprar item', description: 'Compra um item da Vitrine.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'vender', usage: '.vender item', description: 'Vende um item da mochila.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'mochila', usage: '.mochila', description: 'Mostra itens e materiais guardados.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'usar', usage: '.usar item', description: 'Usa um item disponível na mochila.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'atelier', usage: '.atelier', description: 'Abre a bancada de criações.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'criar', usage: '.criar receita', description: 'Cria um item usando materiais.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'receitas', usage: '.receitas', description: 'Mostra as receitas disponíveis no Ateliê.', menuGroup: 'Vitrine e Ateliê' },
  { name: 'sorte', usage: '.sorte 100', description: 'Faz uma rodada da Estrela da Sorte.', menuGroup: 'Risco e Sorte' },
  { name: 'roubar', usage: '.roubar @pessoa', description: 'Tenta uma rota arriscada contra outra carteira.', menuGroup: 'Risco e Sorte' }
]

export default defineCommand({
  name: 'eco',
  aliases: [
    'economia', 'saldo', 'carteira', 'perfil', 'rg', 'registrar', 'registro',
    'rotina', 'diario', 'daily', 'colher', 'recompensadiaria', 'recompensa', 'caixadiaria', 'caixa', 'boxdiaria',
    'oficio', 'emprego', 'trabalhar', 'work', 'bico',
    'banco', 'cofre', 'depositar', 'dep', 'sacar', 'saque', 'rendimento',
    'pix', 'pagar', 'transferir', 'pixconfirm', 'pixcancel',
    'investir', 'investimentos', 'resgatarinvest', 'resgatarinvestimento',
    'ofertar', 'ofertas', 'aceitaroferta', 'recusaroferta', 'cancelaroferta',
    'minhaloja', 'criarloja', 'nomeloja', 'anunciar', 'retiraranuncio', 'lojade', 'comprarloja',
    'pets', 'pet', 'comprarpet', 'equiparpet', 'petativo', 'evoluirpet',
    'casa', 'comprarcasa', 'entrarcasa', 'dormir',
    'economiagrupo', 'limitepetalas',
    'loja', 'shop', 'comprar', 'vender', 'atelier', 'craft', 'criar', 'receitas', 'mochila', 'inventario', 'usar',
    'jornada', 'aventura', 'minerar', 'mina', 'ouro', 'gold', 'trocarouro', 'venderouro', 'picareta', 'pickaxe', 'melhorarpicareta', 'uppicareta', 'pescar', 'explorar', 'jardim', 'crime',
    'missao', 'missoes', 'conquistas', 'extrato', 'transacoes',
    'roubar', 'assaltar', 'sorte', 'apostar', 'bet'
  ],
  menuEntries,
  category: 'Economia',
  usage: '.eco',
  description: 'Jardim de Sakura Coins, conta, rotinas, itens e transferências.',

  async execute({ sock, msg, args, rawArgs = '', text, settings, senderNumber, chatNumber = '', isGroup = false, isAdmin = false, logger }) {
    const used = usedCommand(text, settings.prefix)
    const groupChat = isGroup ? String(chatNumber || msg.key.remoteJid || '') : ''
    const registration = await register(senderNumber)
    let account = registration.account
    const vipState = await getVipBenefits(senderNumber)
    const vip = vipState.active

    if (['eco', 'economia'].includes(used)) {
      return sendEconomyHub({ sock, msg, account, number: senderNumber, logger })
    }

    if (['rg', 'registrar', 'registro'].includes(used)) {
      const line = registration.created ? '💮 Sua conta floresceu com 250 Sakura Coins.' : '💮 Sua conta já estava pronta.'
      await simpleResult(sock, msg, line)
      return sendBalance({ sock, msg, account: registration.account, number: senderNumber, logger })
    }

    if (['saldo', 'carteira'].includes(used)) {
      return sendBalance({ sock, msg, account, number: senderNumber, logger })
    }

    if (used === 'perfil') {
      const target = await resolveProfileTarget(sock, msg, args, senderNumber)
      const targetAccount = target.number === senderNumber ? account : await getAccount(target.number)
      let image = await getProfileImage(sock, target.jid, target.number, logger)
      if (!image?.buffer) {
        try { image = { buffer: await fs.readFile(settings.menuLogoPath), fallback: true } } catch { image = null }
      }
      const ownProfile = target.number === senderNumber
      const targetVip = await isVip(target.number)
      const names = msg.key.remoteJid?.endsWith('@g.us') ? await groupNameMap(sock, msg.key.remoteJid) : new Map()
      const person = displayUser(target.number, names)
      const displayName = ownProfile ? (msg.pushName || person.name || `@${target.number}`) : (person.name || `@${target.number}`)
      rememberUser({ number: target.number, jid: person.jid || target.jid, name: displayName.startsWith('@') ? '' : displayName, source: 'profile' })
      const profileJid = person.phoneJid || person.mentionJid || (target.number ? `${target.number}@s.whatsapp.net` : target.jid)
      const device = ownProfile ? getDevice(msg.key.id) : 'unknown'
      return sendProfile({
        sock,
        msg,
        account: targetAccount,
        number: target.number,
        jid: profileJid,
        displayName,
        image,
        vip: targetVip,
        device,
        mentions: [profileJid].filter(Boolean),
        logger
      })
    }

    if (used === 'rotina') return sendRoutine({ sock, msg, account, logger })

    if (['diario', 'daily', 'colher', 'recompensadiaria', 'recompensa'].includes(used)) {
      const result = await daily(senderNumber, { vip, dailyMultiplier: vipState.dailyMultiplier, chat: groupChat })
      if (!result.ok) return simpleResult(sock, msg, '💮 A colheita de hoje já foi feita. Volte amanhã.')
      const itemLine = result.item ? `\n🌸 *surpresa:* ${result.item.icon} ${result.item.name}` : ''
      return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(`💮 *colheita:* +${money(result.reward)}\n💮 *sequência:* ${result.account.streak} dias${itemLine}`, result.unlocked), result))
    }

    if (['caixadiaria', 'caixa', 'boxdiaria'].includes(used)) {
      if (!args[0]) return sendDailyBoxPanel({ sock, msg, account, logger })
      const result = await claimDailyBox(senderNumber, { vip, chat: groupChat })
      if (!result.ok) return simpleResult(sock, msg, '💮 A caixa diária de hoje já foi aberta. Volte amanhã.')
      const item = result.item ? `\n🌸 *item:* ${result.item.icon} ${result.item.name}` : ''
      return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(`🌸 *${result.label}*\n💮 *Sakura Coins:* +${money(result.petals)}\n💮 *ouro:* +${result.gold}${item}`, result.unlocked), result))
    }

    if (['ouro', 'gold'].includes(used)) {
      const status = await getMiningStatus(senderNumber)
      return sendMiningPanel({ sock, msg, status, logger })
    }

    if (['picareta', 'pickaxe'].includes(used)) {
      account = (await getMiningStatus(senderNumber)).account
      return sendPickaxePanel({ sock, msg, account, logger })
    }

    if (['melhorarpicareta', 'uppicareta'].includes(used)) {
      const result = await upgradePickaxe(senderNumber)
      if (!result.ok && result.reason === 'max') return simpleResult(sock, msg, '💮 Sua Picareta Sakura já está no nível máximo.')
      if (!result.ok && result.reason === 'materials') return simpleResult(sock, msg, `💮 Falta material para a próxima melhoria: *${result.missing}*.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 Você ainda não possui ouro, Sakura Coins ou materiais suficientes para essa melhoria.')
      return simpleResult(sock, msg, appendUnlocked(`🌸 *picareta melhorada*\n${result.pickaxe.icon} *${result.pickaxe.name}*\n🌸 *multiplicador:* ${result.pickaxe.multiplier.toFixed(2)}x`, result.unlocked))
    }

    if (['trocarouro', 'venderouro'].includes(used)) {
      const status = await getMiningStatus(senderNumber)
      const amount = /^(tudo|all)$/i.test(args[0] || '') ? status.account.gold : numberValue(args[0])
      if (!amount) return simpleResult(sock, msg, `💮 Use *${settings.prefix}trocarouro quantidade* ou *${settings.prefix}trocarouro tudo*.`)
      const result = await convertGold(senderNumber, amount)
      if (!result.ok) return simpleResult(sock, msg, '💮 Você não possui essa quantidade de ouro.')
      return simpleResult(sock, msg, appendUnlocked(`💮 *ouro convertido:* ${result.gold}\n💮 *recebido:* +${money(result.petals)}\n🌸 *cotação:* 1 ouro = ${result.rate} Sakura Coins`, result.unlocked))
    }

    if (['minerar', 'mina'].includes(used)) {
      const result = await mineGold(senderNumber, { vip, chat: groupChat })
      if (!result.ok && result.reason === 'cooldown') return simpleResult(sock, msg, `💮 A Mina Sakura reabre em *${duration(result.left)}*.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 A mineração não pôde ser concluída agora.')
      const item = result.item ? `\n🌸 *achado raro:* ${result.item.icon} ${result.item.name}` : ''
      return economyMediaResult(sock, msg, 'minerar', appendGroupLimit(appendUnlocked(`💮 *mineração concluída*\n💮 *ouro:* +${result.gold}\n💮 *Sakura Coins:* +${money(result.petals)}\n🌸 *picareta:* ${result.pickaxe.name}${item}`, result.unlocked), result))
    }

    if (['oficio', 'emprego'].includes(used)) {
      const selected = normalize(args[0])
      if (!selected) return sendJobs({ sock, msg, account, logger })
      const result = await setJob(senderNumber, selected)
      if (!result.ok) return sendJobs({ sock, msg, account, logger })
      return simpleResult(sock, msg, `${result.job.icon} Agora você atua como *${result.job.name}*.`)
    }

    if (['trabalhar', 'work', 'bico'].includes(used)) {
      const result = await work(senderNumber, { vip, workMultiplier: vipState.workMultiplier, chat: groupChat })
      if (!result.ok) return simpleResult(sock, msg, `💮 O próximo turno abre em *${duration(result.left)}*.`)
      const boost = result.multiplier > 1 ? '\n🌸 *bônus Hanami ativado*' : ''
      return economyMediaResult(sock, msg, 'trabalhar', appendGroupLimit(appendUnlocked(`${result.job.icon} *${result.job.name}:* +${money(result.reward)}${boost}`, result.unlocked), result))
    }

    if (['banco', 'cofre'].includes(used)) return sendBank({ sock, msg, account, logger })

    if (['depositar', 'dep'].includes(used)) {
      if (!args[0]) return sendBank({ sock, msg, account, logger })
      const amount = /^(tudo|all)$/i.test(args[0] || '') ? account.wallet : numberValue(args[0])
      const result = await deposit(senderNumber, amount)
      if (!result.ok) return simpleResult(sock, msg, '💮 Não há Sakura Coins suficientes na carteira.')
      await simpleResult(sock, msg, `💮 Guardado no cofre: *${money(result.amount)}*.`)
      return sendBank({ sock, msg, account: result.account, logger })
    }

    if (['sacar', 'saque'].includes(used)) {
      if (!args[0]) return sendBank({ sock, msg, account, logger })
      const amount = /^(tudo|all)$/i.test(args[0] || '') ? account.bank : numberValue(args[0])
      const result = await withdraw(senderNumber, amount)
      if (!result.ok) return simpleResult(sock, msg, '💮 Não há Sakura Coins suficientes no cofre.')
      await simpleResult(sock, msg, `💮 Retirado do cofre: *${money(result.amount)}*.`)
      return sendBank({ sock, msg, account: result.account, logger })
    }

    if (used === 'rendimento') {
      const result = await claimYield(senderNumber, { chat: groupChat })
      if (!result.ok && result.reason === 'minimum') return simpleResult(sock, msg, '💮 O cofre precisa ter pelo menos ₱500 para florescer.')
      if (!result.ok) return simpleResult(sock, msg, '💮 O rendimento de hoje já foi colhido.')
      return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(`🌸 *rendimento:* +${money(result.reward)} no cofre.`, result.unlocked), result))
    }

    if (['pix', 'pagar', 'transferir'].includes(used)) {
      const to = targetNumber(msg, args)
      const amount = numberValue(args.at(-1))
      if (!to || !amount) return simpleResult(sock, msg, `💮 Use *${settings.prefix}${used} @pessoa valor*.`)
      const pending = await beginTransfer(senderNumber, to, amount, { chat: groupChat })
      if (!pending.ok) return simpleResult(sock, msg, pending.reason === 'self' ? '💮 Você não pode enviar Sakura Coins para si.' : '💮 Confira o destino e o saldo da carteira.')
      return sendTransferConfirmation({ sock, msg, pending, logger })
    }

    if (used === 'pixconfirm') {
      const result = await confirmTransfer(String(args[0] || ''), senderNumber)
      if (!result.ok) return simpleResult(sock, msg, '💮 Esta confirmação expirou ou não pertence à sua conta.')
      return simpleResult(sock, msg, appendUnlocked(`💮 PIX concluído\n💮 *destino:* ${shortNumber(result.to)}\n🌸 *valor:* ${money(result.amount)}`, result.unlocked))
    }

    if (used === 'pixcancel') {
      const result = await cancelTransfer(String(args[0] || ''), senderNumber)
      return simpleResult(sock, msg, result.ok ? '💮 Movimento cancelado. Nenhuma Sakura Coin saiu da conta.' : '💮 Esta confirmação já expirou.')
    }

    if (['investir', 'investimentos'].includes(used)) {
      if (used === 'investimentos' || !args[0]) {
        const data = await listInvestments(senderNumber)
        return sendInvestmentPanel({ sock, msg, data, logger })
      }
      const planId = normalize(args[0])
      const amount = numberValue(args[1])
      if (!amount) return simpleResult(sock, msg, `💮 Use *${settings.prefix}investir conservador 500*.`)
      const result = await startInvestment(senderNumber, planId, amount, { chat: groupChat })
      if (!result.ok && result.reason === 'plan') return simpleResult(sock, msg, '💮 Plano inválido. Use conservador, equilibrado ou arrojado.')
      if (!result.ok && result.reason === 'range') return simpleResult(sock, msg, `💮 Este plano aceita valores entre *${money(result.min)}* e *${money(result.max)}*.`)
      if (!result.ok && result.reason === 'limit') return simpleResult(sock, msg, '💮 Você já possui três investimentos ativos.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Sua carteira não alcança esse investimento.')
      return simpleResult(sock, msg, `${result.plan.icon} *investimento iniciado*\n🌸 *valor:* ${money(result.investment.amount)}\n💮 *prazo:* ${duration(result.plan.durationMs)}\n🌸 *resgate:* ${result.investment.id}`)
    }

    if (['resgatarinvest', 'resgatarinvestimento'].includes(used)) {
      const id = String(args[0] || '').toUpperCase()
      if (!id) return simpleResult(sock, msg, `💮 Use *${settings.prefix}resgatarinvest ID*.`)
      const result = await claimInvestment(senderNumber, id, { chat: groupChat })
      if (!result.ok && result.reason === 'pending') return simpleResult(sock, msg, `💮 Este investimento termina em *${duration(result.left)}*.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 Investimento inexistente ou já resgatado.')
      const delta = result.profit >= 0 ? `+${money(result.profit)}` : `-${money(Math.abs(result.profit))}`
      return simpleResult(sock, msg, appendGroupLimit(`🌸 *investimento resgatado*\n🌸 *recebido:* ${money(result.payout)}\n🌸 *resultado:* ${delta}`, result))
    }

    if (used === 'ofertar') {
      if (!isGroup) return simpleResult(sock, msg, '💮 Ofertas entre membros funcionam apenas em grupos.')
      const to = targetNumber(msg, args)
      const itemId = normalize(args.at(-3))
      const quantity = numberValue(args.at(-2))
      const price = numberValue(args.at(-1))
      if (!to || !itemId || !quantity || !price) return simpleResult(sock, msg, `💮 Use *${settings.prefix}ofertar @pessoa item quantidade preço_total*.`)
      const result = await createTradeOffer(senderNumber, to, itemId, quantity, price, groupChat)
      if (!result.ok && result.reason === 'self') return simpleResult(sock, msg, '💮 Você não pode criar uma oferta para si.')
      if (!result.ok && result.reason === 'limit') return simpleResult(sock, msg, '💮 Limite de cinco ofertas pendentes alcançado.')
      if (!result.ok && result.reason === 'stock') return simpleResult(sock, msg, '💮 Sua mochila não possui essa quantidade.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Item inválido para oferta.')
      return simpleResult(sock, msg, `${result.item.icon} *oferta criada*\n🌸 *ID:* ${result.offer.id}\n🌸 *item:* ${result.item.name} x${result.offer.quantity}\n💮 *preço total:* ${money(result.offer.price)}\n💮 *validade:* 10 minutos`, { mentions: [`${to}@s.whatsapp.net`] })
    }

    if (used === 'ofertas') {
      const offers = await listTradeOffers(senderNumber, groupChat)
      return sendOffersPanel({ sock, msg, offers, number: senderNumber, logger })
    }

    if (used === 'aceitaroferta') {
      const result = await acceptTradeOffer(String(args[0] || ''), senderNumber, groupChat)
      if (!result.ok && result.reason === 'money') return simpleResult(sock, msg, '💮 Sua carteira não alcança esta oferta.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Oferta expirada, inválida ou destinada a outra pessoa.')
      return simpleResult(sock, msg, `${result.item.icon} *oferta concluída*\n🌸 *recebido:* ${result.item.name} x${result.offer.quantity}\n💮 *pago:* ${money(result.offer.price)}`)
    }

    if (used === 'recusaroferta') {
      const result = await closeTradeOffer(String(args[0] || ''), senderNumber, 'reject', groupChat)
      return simpleResult(sock, msg, result.ok ? '💮 Oferta recusada e item devolvido ao vendedor.' : '💮 Oferta expirada ou inválida.')
    }

    if (used === 'cancelaroferta') {
      const result = await closeTradeOffer(String(args[0] || ''), senderNumber, 'cancel', groupChat)
      return simpleResult(sock, msg, result.ok ? '💮 Oferta cancelada e item devolvido à sua mochila.' : '💮 Oferta expirada ou inválida.')
    }

    if (['criarloja', 'nomeloja'].includes(used)) {
      const name = rawArgs.trim()
      if (!name) return simpleResult(sock, msg, `💮 Use *${settings.prefix}criarloja Nome da loja*.`)
      const result = await createUserShop(senderNumber, name)
      if (!result.ok) return simpleResult(sock, msg, '💮 Escolha um nome válido entre 3 e 32 caracteres, sem links ou menções.')
      return simpleResult(sock, msg, `🌸 Sua loja agora se chama *${result.shop.name}*.`)
    }

    if (used === 'minhaloja') {
      const data = await getUserShop(senderNumber)
      return sendUserShopPanel({ sock, msg, owner: senderNumber, data, own: true, logger })
    }

    if (used === 'anunciar') {
      const itemId = normalize(args[0])
      const quantity = numberValue(args[1])
      const unitPrice = numberValue(args[2])
      if (!itemId || !quantity || !unitPrice) return simpleResult(sock, msg, `💮 Use *${settings.prefix}anunciar item quantidade preço_unitário*.`)
      const result = await addShopListing(senderNumber, itemId, quantity, unitPrice)
      if (!result.ok && result.reason === 'shop') return simpleResult(sock, msg, `💮 Crie sua loja primeiro com *${settings.prefix}criarloja Nome*.`)
      if (!result.ok && result.reason === 'limit') return simpleResult(sock, msg, '💮 Sua loja já possui oito anúncios ativos.')
      if (!result.ok && result.reason === 'stock') return simpleResult(sock, msg, '💮 Sua mochila não possui essa quantidade.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Item inválido para anúncio.')
      return simpleResult(sock, msg, `${result.item.icon} *anúncio criado*\n🌸 *ID:* ${result.listing.id}\n🌸 *estoque:* ${result.listing.stock}\n💮 *preço unitário:* ${money(result.listing.unitPrice)}`)
    }

    if (used === 'retiraranuncio') {
      const result = await removeShopListing(senderNumber, String(args[0] || ''))
      return simpleResult(sock, msg, result.ok ? '🌸 Anúncio removido e estoque devolvido à mochila.' : '💮 Anúncio inexistente.')
    }

    if (used === 'lojade') {
      const owner = targetNumber(msg, args)
      if (!owner) return simpleResult(sock, msg, `💮 Use *${settings.prefix}lojade @pessoa*.`)
      const data = await getUserShop(owner)
      return sendUserShopPanel({ sock, msg, owner, data, own: owner === senderNumber, logger, mentionJid: `${owner}@s.whatsapp.net` })
    }

    if (used === 'comprarloja') {
      const owner = targetNumber(msg, args)
      const listingIndex = args.findIndex(value => /^ANU-/i.test(String(value)))
      const listingId = listingIndex >= 0 ? String(args[listingIndex]).toUpperCase() : ''
      const quantity = listingIndex >= 0 ? (numberValue(args[listingIndex + 1]) || 1) : 0
      if (!owner || !listingId) return simpleResult(sock, msg, `💮 Use *${settings.prefix}comprarloja @pessoa ID quantidade*.`)
      const result = await buyFromUserShop(senderNumber, owner, listingId, quantity, groupChat)
      if (!result.ok && result.reason === 'self') return simpleResult(sock, msg, '💮 Você não pode comprar da própria loja.')
      if (!result.ok && result.reason === 'money') return simpleResult(sock, msg, `💮 Sua carteira não alcança *${money(result.total)}*.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 Anúncio inexistente ou sem estoque suficiente.')
      return simpleResult(sock, msg, `${result.item.icon} *compra concluída*\n🌸 *item:* ${result.item.name} x${result.quantity}\n💮 *total:* ${money(result.total)}\n💮 *taxa anti-inflação:* ${money(result.fee)}`)
    }

    if (['pets', 'pet'].includes(used)) {
      const data = await getPets(senderNumber)
      return sendPetsPanel({ sock, msg, data, logger })
    }

    if (used === 'comprarpet') {
      const result = await buyPet(senderNumber, normalize(args[0]))
      if (!result.ok && result.reason === 'owned') return simpleResult(sock, msg, '💮 Esse pet já faz parte da sua coleção.')
      if (!result.ok && result.reason === 'money') return simpleResult(sock, msg, '💮 Faltam Sakura Coins ou ouro para desbloquear esse pet.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Pet inexistente.')
      return simpleResult(sock, msg, `${result.pet.icon} *${result.pet.name}* entrou para sua família.${result.active ? '\n🌸 Ele foi ativado automaticamente.' : ''}`)
    }

    if (['equiparpet', 'petativo'].includes(used)) {
      const result = await setActivePet(senderNumber, normalize(args[0]))
      if (!result.ok) return simpleResult(sock, msg, '💮 Você ainda não possui esse pet.')
      return simpleResult(sock, msg, `${result.pet.icon} *${result.pet.name}* agora é seu pet ativo.`)
    }

    if (used === 'evoluirpet') {
      const result = await evolvePet(senderNumber, normalize(args[0]))
      if (!result.ok && result.reason === 'max') return simpleResult(sock, msg, '💮 Esse pet já está no nível máximo.')
      if (!result.ok && result.reason === 'money') return simpleResult(sock, msg, `💮 A evolução exige *${money(result.petals)}* e *${result.gold} ouro*.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 Pet não encontrado na sua coleção.')
      return simpleResult(sock, msg, `${result.pet.icon} *${result.pet.name} evoluiu para o nível ${result.owned.level}*.`)
    }

    if (['casa', 'entrarcasa'].includes(used)) {
      const data = await getHouse(senderNumber)
      return sendHousePanel({ sock, msg, data, logger })
    }

    if (used === 'comprarcasa') {
      const result = await buyHouse(senderNumber, normalize(args[0]))
      if (!result.ok && result.reason === 'order') return simpleResult(sock, msg, '💮 As casas precisam ser compradas em ordem: cabana, casa, mansão e palácio.')
      if (!result.ok && result.reason === 'owned') return simpleResult(sock, msg, '💮 Você já possui essa casa ou uma melhor.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Faltam Sakura Coins ou ouro para essa moradia.')
      return simpleResult(sock, msg, `${result.house.icon} *${result.house.name} comprada*\n🌸 Redução por descanso: *${duration(result.house.sleepReductionMs)}*.`)
    }

    if (used === 'dormir') {
      const result = await sleepAtHome(senderNumber)
      if (!result.ok && result.reason === 'house') return simpleResult(sock, msg, `💮 Compre uma cabana com *${settings.prefix}comprarcasa cabana* para poder dormir.`)
      if (!result.ok) return simpleResult(sock, msg, '💮 Você já usou todos os descansos disponíveis hoje.')
      return simpleResult(sock, msg, `${result.house.icon} *descanso concluído*\n💮 Cooldowns de trabalho, mineração e jornadas foram reduzidos em *${duration(result.reduction)}*.`)
    }

    if (used === 'economiagrupo') {
      if (!isGroup) return simpleResult(sock, msg, '💮 Este painel funciona apenas em grupos.')
      const status = await getGroupEconomyStatus(groupChat)
      return sendGroupEconomyPanel({ sock, msg, status, logger })
    }

    if (used === 'limitepetalas') {
      if (!isGroup) return simpleResult(sock, msg, '💮 Esta configuração funciona apenas em grupos.')
      if (!isAdmin) return simpleResult(sock, msg, '💮 Apenas administradores, subdonos ou o dono podem alterar esse limite.')
      const value = numberValue(args[0])
      if (!value) return simpleResult(sock, msg, `💮 Use *${settings.prefix}limitepetalas 100000*.`)
      const result = await setGroupEconomyLimit(groupChat, value)
      return simpleResult(sock, msg, `🌸 Limite diário de emissão ajustado para *${money(result.limit)}*.`)
    }

    if (['loja', 'shop'].includes(used)) return sendShop({ sock, msg, account, logger })

    if (used === 'comprar') {
      if (!args[0]) return sendShop({ sock, msg, account, logger })
      const itemId = normalize(args[0])
      const quantity = numberValue(args[1]) || 1
      const result = await buyItem(senderNumber, itemId, quantity)
      if (!result.ok) return simpleResult(sock, msg, result.reason === 'money' ? '💮 Sua carteira não alcança esse item.' : '💮 Item não encontrado na vitrine.')
      return simpleResult(sock, msg, appendUnlocked(`${result.item.icon} *${result.item.name} x${result.quantity}* foi para a mochila.\n💮 *custo:* ${money(result.cost)}`, result.unlocked))
    }

    if (used === 'vender') {
      if (!args[0]) {
        const inventory = await getInventory(senderNumber)
        return sendInventory({ sock, msg, account, inventory, logger })
      }
      const itemId = normalize(args[0])
      const quantity = numberValue(args[1]) || 1
      const result = await sellItem(senderNumber, itemId, quantity, { chat: groupChat })
      if (!result.ok && result.reason === 'group-limit') return simpleResult(sock, msg, '💮 A emissão diária deste grupo chegou ao limite. Seus itens não foram removidos.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Esse item não está disponível na quantidade pedida.')
      return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(`${result.item.icon} Item vendido por *${money(result.reward)}*.`, result.unlocked), result))
    }

    if (['mochila', 'inventario'].includes(used)) {
      const inventory = await getInventory(senderNumber)
      return sendInventory({ sock, msg, account, inventory, logger })
    }

    if (['atelier', 'craft', 'receitas'].includes(used)) {
      const inventory = await getInventory(senderNumber)
      return sendWorkshop({ sock, msg, account, inventory, logger })
    }

    if (used === 'criar') {
      const recipeId = normalize(args[0])
      if (!recipeId) {
        const inventory = await getInventory(senderNumber)
        return sendWorkshop({ sock, msg, account, inventory, logger })
      }
      const result = await craftItem(senderNumber, recipeId)
      if (!result.ok && result.reason === 'materials') {
        const inventory = await getInventory(senderNumber)
        await simpleResult(sock, msg, '💮 Ainda faltam materiais para essa criação.')
        return sendWorkshop({ sock, msg, account: result.account, inventory, logger })
      }
      if (!result.ok) return simpleResult(sock, msg, '💮 Essa criação não existe no Ateliê Sakura.')
      return simpleResult(sock, msg, appendUnlocked(`${result.recipe.icon} *${result.recipe.name}* foi criado e guardado na mochila.`, result.unlocked))
    }

    if (used === 'usar') {
      if (!args[0]) {
        const inventory = await getInventory(senderNumber)
        return sendInventory({ sock, msg, account, inventory, logger })
      }
      const result = await useItem(senderNumber, normalize(args[0]), { chat: groupChat })
      if (!result.ok && result.reason === 'collectible') return simpleResult(sock, msg, '🌸 Essa raridade foi feita para ficar na coleção.')
      if (!result.ok && result.reason === 'material') return simpleResult(sock, msg, `${result.item.icon} *${result.item.name}* é material do Ateliê e não pode ser usado sozinho.`)
      if (!result.ok && result.reason === 'group-limit') return simpleResult(sock, msg, '💮 A emissão diária deste grupo chegou ao limite. A chave continua guardada na sua mochila.')
      if (!result.ok) return simpleResult(sock, msg, '💮 Esse item não está na sua mochila.')
      const reward = result.reward ? `\n💮 *caixa aberta:* +${money(result.reward)}` : ''
      return simpleResult(sock, msg, appendUnlocked(`${result.item.icon} *${result.item.name}* ativado.${reward}`, result.unlocked))
    }

    if (['jornada', 'aventura'].includes(used)) return sendJourney({ sock, msg, account, logger })

    if (['pescar', 'explorar', 'jardim', 'crime'].includes(used)) {
      const result = await economyAction(senderNumber, used, { chat: groupChat })
      if (!result.ok && result.reason === 'cooldown') return simpleResult(sock, msg, `💮 Esse caminho reabre em *${duration(result.left)}*.`)
      if (!result.ok && result.reason === 'loss') return economyMediaResult(sock, msg, used, appendUnlocked(`${result.rule.icon} A jornada teve um imprevisto: *-${money(result.loss)}*.`, result.unlocked), 'falha')
      if (!result.ok) return simpleResult(sock, msg, '💮 Caminho indisponível agora.')
      const item = result.item ? `\n🌸 *achado:* ${result.item.icon} ${result.item.name}` : ''
      return economyMediaResult(sock, msg, used, appendGroupLimit(appendUnlocked(`${result.rule.icon} *${result.rule.name}:* +${money(result.reward)}${item}`, result.unlocked), result), result.item ? 'raro' : 'sucesso')
    }

    if (['missao', 'missoes'].includes(used)) {
      if (normalize(args[0]) === 'claim') {
        const result = await claimMission(senderNumber, normalize(args[1]), { chat: groupChat })
        if (!result.ok && result.reason === 'progress') return simpleResult(sock, msg, `💮 Esta estrela ainda está em ${result.quest.progress}/${result.quest.target}.`)
        if (!result.ok) return simpleResult(sock, msg, '💮 Esta estrela já foi colhida ou não existe.')
        return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(`🌸 *estrela concluída:* +${money(result.reward)}.`, result.unlocked), result))
      }
      const missions = await getMissions(senderNumber)
      return sendMissions({ sock, msg, missions, logger })
    }

    if (used === 'conquistas') {
      const achievements = await getAchievements(senderNumber)
      return sendAchievements({ sock, msg, achievements, logger })
    }

    if (['extrato', 'transacoes'].includes(used)) {
      const entries = await getStatement(senderNumber, 12)
      return sendStatement({ sock, msg, entries, account, logger })
    }

    if (['roubar', 'assaltar'].includes(used)) {
      const to = targetNumber(msg, args)
      if (!to) return simpleResult(sock, msg, `💮 Use *${settings.prefix}${used} @pessoa*.`)
      const result = await rob(senderNumber, to)
      if (!result.ok && result.reason === 'cooldown') return simpleResult(sock, msg, `💮 A próxima rota abre em *${duration(result.left)}*.`)
      if (!result.ok && result.reason === 'protected') return simpleResult(sock, msg, '🌸 Essa carteira está protegida por um Selo de Cerejeira.')
      if (!result.ok && result.reason === 'caught') return simpleResult(sock, msg, appendUnlocked(`💮 A rota falhou: *-${money(result.loss)}*.`, result.unlocked))
      if (!result.ok) return simpleResult(sock, msg, '💮 Esse destino não pode ser visitado agora.')
      return simpleResult(sock, msg, appendUnlocked(`💮 Rota concluída: *+${money(result.amount)}*.`, result.unlocked))
    }

    if (['sorte', 'apostar', 'bet'].includes(used)) {
      const amount = numberValue(args[0])
      if (!amount) return simpleResult(sock, msg, `💮 Use *${settings.prefix}sorte valor*.`)
      const result = await bet(senderNumber, amount, { chat: groupChat })
      if (!result.ok) return simpleResult(sock, msg, '💮 Sua carteira não alcança essa rodada.')
      const line = result.won ? `🌸 A estrela brilhou: *+${money(result.amount)}*.` : `💮 A estrela apagou: *-${money(result.amount)}*.`
      return simpleResult(sock, msg, appendGroupLimit(appendUnlocked(line, result.unlocked), result))
    }

    return sendEconomyHub({ sock, msg, account, number: senderNumber, logger })
  }
})
