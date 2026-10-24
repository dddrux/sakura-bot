import { sendNativeList } from './interactive.js'
import { formatMessage } from './formatter.js'
import { settings } from './settings.js'
import { HOUSE_CATALOG, INVESTMENT_PLANS, PET_CATALOG, formatPart3Duration } from './economy-part3.js'
import { SHOP_ITEMS } from './economy.js'
import { money } from './economy-ui.js'

async function sendList({ sock, msg, logger, kind, title, body, sections, buttonText = '💮 abrir', mentions = [] }) {
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind,
    body: formatMessage(body, { title, icon: '💮', footerIcon: '💮' }),
    sections,
    buttonText,
    mentions
  })
}

export async function sendInvestmentPanel({ sock, msg, data, logger }) {
  const active = data.active || []
  const activeLines = active.length
    ? active.map(item => {
        const plan = INVESTMENT_PLANS[item.planId]
        const left = Math.max(0, item.endsAt - Date.now())
        return `${plan?.icon || '💮'} *${item.id}* — ${money(item.amount)} • ${left ? formatPart3Duration(left) : 'pronto para resgate'}`
      }).join('\n')
    : '🌸 Nenhum investimento ativo.'
  return sendList({
    sock, msg, logger, kind: 'economy-investments', title: 'INVESTIMENTOS SAKURA',
    body: `${activeLines}\n\n💮 Até 3 investimentos simultâneos. O resultado é definido no início e só pode ser resgatado após o prazo.`,
    buttonText: '🌸 Abrir investimentos',
    sections: [
      {
        title: '🌸 Novos investimentos',
        rows: Object.values(INVESTMENT_PLANS).map(plan => ({
          id: `${settings.prefix}investir ${plan.id} ${plan.min}`,
          title: `${plan.icon} ${plan.name}`,
          description: `${money(plan.min)}–${money(plan.max)} • ${formatPart3Duration(plan.durationMs)}`
        }))
      },
      {
        title: '🌸 Ativos',
        rows: active.length ? active.slice(0, 10).map(item => ({
          id: `${settings.prefix}resgatarinvest ${item.id}`,
          title: `${Date.now() >= item.endsAt ? '💮' : '💮'} ${item.id}`,
          description: Date.now() >= item.endsAt ? 'Pronto para resgate' : `Faltam ${formatPart3Duration(item.endsAt - Date.now())}`
        })) : [{ id: `${settings.prefix}investir conservador 500`, title: '💮 Começar com segurança', description: 'Investimento mínimo de 500 Sakura Coins' }]
      }
    ]
  })
}

export async function sendOffersPanel({ sock, msg, offers, number, logger }) {
  const rows = offers.map(offer => {
    const incoming = offer.to === number
    const item = SHOP_ITEMS[offer.itemId]
    return {
      id: incoming ? `${settings.prefix}aceitaroferta ${offer.id}` : `${settings.prefix}cancelaroferta ${offer.id}`,
      title: `${incoming ? '🌸' : '💮'} ${offer.id}`,
      description: `${item?.name || offer.itemId} x${offer.quantity} • ${money(offer.price)}`
    }
  })
  return sendList({
    sock, msg, logger, kind: 'economy-offers', title: 'OFERTAS ENTRE MEMBROS',
    body: offers.length ? '💮 Ofertas reservam o item por 10 minutos e só concluem após aceite.' : '🌸 Você não possui ofertas pendentes neste grupo.',
    buttonText: '🌸 Ver ofertas',
    sections: [{
      title: '🌸 Pendentes',
      rows: rows.length ? rows : [{ id: `${settings.prefix}mochila`, title: '🌸 Abrir mochila', description: 'Escolha um item antes de criar uma oferta' }]
    }]
  })
}

export async function sendUserShopPanel({ sock, msg, owner, data, own = false, logger, mentionJid = '' }) {
  const shop = data.shop
  const listings = Object.values(shop.listings || {})
  const body = shop.name
    ? [`🌸 *loja:* ${shop.name}`, `🌸 *anúncios:* ${listings.length}`, `💮 *vendas:* ${shop.sales || 0}`, `💮 *receita:* ${money(shop.revenue || 0)}`].join('\n')
    : own ? '🌸 Você ainda não criou sua loja.' : '🌸 Esta pessoa ainda não criou uma loja.'
  const rows = listings.map(listing => {
    const item = SHOP_ITEMS[listing.itemId]
    return {
      id: own ? `${settings.prefix}retiraranuncio ${listing.id}` : `${settings.prefix}comprarloja ${owner} ${listing.id} 1`,
      title: `${item?.icon || '🌸'} ${item?.name || listing.itemId} x${listing.stock}`,
      description: `${money(listing.unitPrice)} cada • ${listing.id}`
    }
  })
  if (!rows.length) rows.push({
    id: own ? `${settings.prefix}mochila` : `${settings.prefix}loja`,
    title: own ? '🌸 Nenhum anúncio' : '🌸 Vitrine vazia',
    description: own ? 'Use .anunciar item quantidade preço' : 'Consulte outra loja'
  })
  return sendList({
    sock, msg, logger, kind: 'economy-user-shop', title: own ? 'MINHA LOJA' : 'LOJA DE MEMBRO', body,
    buttonText: '🌸 Abrir loja', mentions: mentionJid ? [mentionJid] : [],
    sections: [
      { title: '🌸 Vitrine', rows },
      ...(own ? [{ title: '💮 Gerenciar', rows: [
        { id: `${settings.prefix}criarloja ${shop.name || 'Loja Sakura'}`, title: shop.name ? '🌸 Renomear loja' : '🌸 Criar loja', description: 'Nome entre 3 e 32 caracteres' },
        { id: `${settings.prefix}mochila`, title: '🌸 Abrir mochila', description: 'Ver itens que podem ser anunciados' }
      ] }] : [])
    ]
  })
}

export async function sendPetsPanel({ sock, msg, data, logger }) {
  const active = PET_CATALOG[data.pets.active]
  const ownedCount = Object.keys(data.pets.owned || {}).length
  return sendList({
    sock, msg, logger, kind: 'economy-pets', title: 'PETS SAKURA',
    body: [`🌸 *coleção:* ${ownedCount}/${Object.keys(PET_CATALOG).length}`, `🌸 *pet ativo:* ${active ? `${active.icon} ${active.name}` : 'nenhum'}`, '💮 Apenas um pet concede bônus por vez.'].join('\n'),
    buttonText: '🌸 Abrir pets',
    sections: [{
      title: '🌸 Catálogo',
      rows: Object.values(PET_CATALOG).map(pet => {
        const owned = data.pets.owned?.[pet.id]
        return {
          id: owned ? `${settings.prefix}equiparpet ${pet.id}` : `${settings.prefix}comprarpet ${pet.id}`,
          title: `${owned ? (data.pets.active === pet.id ? '💮' : '🌸') : '🌸'} ${pet.icon} ${pet.name}`,
          description: owned ? `Nível ${owned.level}/${pet.maxLevel} • toque para ativar` : `${money(pet.price)}${pet.gold ? ` • ${pet.gold} ouro` : ''}`
        }
      })
    }]
  })
}

export async function sendHousePanel({ sock, msg, data, logger }) {
  const { house, state } = data
  const next = Object.values(HOUSE_CATALOG).find(item => item.level === house.level + 1)
  return sendList({
    sock, msg, logger, kind: 'economy-house', title: 'CASA SAKURA',
    body: [
      `${house.icon} *moradia:* ${house.name}`,
      `🌸 *descansos hoje:* ${state.sleepsToday}/${house.dailySleeps}`,
      house.sleepReductionMs ? `💮 *redução por descanso:* ${formatPart3Duration(house.sleepReductionMs)}` : '🌸 Compre uma cabana para poder descansar.',
      next ? `🌸 *próxima:* ${next.name} — ${money(next.price)}${next.gold ? ` + ${next.gold} ouro` : ''}` : '💮 Moradia no nível máximo.'
    ].join('\n'),
    buttonText: '🌸 Abrir casa',
    sections: [{
      title: '🌸 Ações',
      rows: [
        { id: `${settings.prefix}dormir`, title: '🌸 Dormir', description: 'Reduz parcialmente cooldowns de trabalho, mineração e jornadas' },
        { id: `${settings.prefix}entrarcasa`, title: '🌸 Entrar em casa', description: 'Ver detalhes da sua moradia' },
        ...(next ? [{ id: `${settings.prefix}comprarcasa ${next.id}`, title: `🌸 Comprar ${next.name}`, description: `${money(next.price)}${next.gold ? ` • ${next.gold} ouro` : ''}` }] : [])
      ]
    }]
  })
}

export async function sendGroupEconomyPanel({ sock, msg, status, logger }) {
  const percent = status.limit ? Math.min(100, Math.round((status.emitted / status.limit) * 100)) : 0
  return sendList({
    sock, msg, logger, kind: 'economy-group-limit', title: 'ECONOMIA DO GRUPO',
    body: [
      `🌸 *dia:* ${status.day}`,
      `🌸 *limite de emissão:* ${money(status.limit)}`,
      `💮 *emitido hoje:* ${money(status.emitted)} (${percent}%)`,
      `💮 *restante:* ${money(status.remaining)}`,
      `🌸 *movimentado entre membros:* ${money(status.moved)}`,
      '🌸 Quando o limite é atingido, novas recompensas em Sakura Coins são reduzidas ou pausadas; transferências e compras entre membros continuam.'
    ].join('\n'),
    buttonText: '🌸 Abrir economia',
    sections: [{ title: '💮 Configuração', rows: [
      { id: `${settings.prefix}limitepetalas 100000`, title: '🌸 Limite padrão', description: '100.000 Sakura Coins por dia' },
      { id: `${settings.prefix}rankinvestidores`, title: '🌸 Ranking de investidores', description: 'Ver maiores investidores' },
      { id: `${settings.prefix}ranklojas`, title: '🌸 Ranking de lojas', description: 'Ver maiores receitas' }
    ] }]
  })
}
