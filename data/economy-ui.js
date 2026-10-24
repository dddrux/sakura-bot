import { formatMessage } from './formatter.js'
import { sendNativeList } from './interactive.js'
import { settings } from './settings.js'
import { getActions, getGoldRate, getJobs, getPickaxes, getRecipes, getShop, rankName, total } from './economy.js'

export const money = value => `${settings.currencyEmoji} ${Math.floor(Number(value) || 0).toLocaleString('pt-BR')}`

export function shortNumber(value = '') {
  const digits = String(value).replace(/\D/g, '')
  if (digits.length < 6) return digits || 'desconhecido'
  return `${digits.slice(0, 3)}•••${digits.slice(-3)}`
}

export function duration(ms = 0) {
  const value = Math.max(0, Math.ceil(Number(ms) || 0))
  const minutes = Math.ceil(value / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours}h${rest ? ` ${rest}m` : ''}`
}

export function accountLines(account, number) {
  const job = getJobs()[account.job] || getJobs().florista
  const quests = Object.values(account.quests?.items || {})
  const complete = quests.filter(item => item.progress >= item.target && !item.claimed).length
  const activeInvestments = Array.isArray(account.investments?.active) ? account.investments.active.length : 0
  return [
    `💮 *conta:* ${shortNumber(number)}`,
    `💮 *carteira:* ${money(account.wallet)}`,
    `🌸 *cofre:* ${money(account.bank)}`,
    `💮 *ouro:* ${Number(account.gold || 0).toLocaleString('pt-BR')}`,
    `💮 *picareta:* ${(getPickaxes()[account.pickaxe] || getPickaxes().madeira).name}`,
    `💮 *patrimônio:* ${money(total(account))}`,
    `💮 *nível:* ${account.level} — ${rankName(account.level)}`,
    `🌸 *ofício:* ${job.icon} ${job.name}`,
    activeInvestments ? `🌸 *investimentos ativos:* ${activeInvestments}` : '🌸 *investimentos:* nenhum ativo',
    complete ? `🌸 *prêmios prontos:* ${complete}` : '🌸 *jardim:* em crescimento'
  ]
}

async function sendList({ sock, msg, title, body, sections, buttonText = '💮 abrir', logger, kind = 'economy', image = null, mentions = [] }) {
  const jid = msg?.key?.remoteJid
  if (!jid) return null
  return sendNativeList({
    sock,
    jid,
    logger,
    quoted: msg,
    kind,
    body: formatMessage(body, { title, icon: '💮', footerIcon: '💮' }),
    sections,
    buttonText,
    image,
    mentions
  })
}

export async function sendEconomyHub({ sock, msg, account, number, logger }) {
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-hub',
    title: 'JARDIM SAKURA',
    body: accountLines(account, number).join('\n'),
    buttonText: '💮 Explorar jardim',
    sections: [
      {
        title: '💮 Minha conta',
        rows: [
          { id: `${settings.prefix}saldo`, title: '💮 Conta', description: 'Carteira, cofre, nível e progresso' },
          { id: `${settings.prefix}extrato`, title: '💮 Memórias', description: 'Movimentos mais recentes' },
          { id: `${settings.prefix}mochila`, title: '🌸 Mochila', description: 'Itens e colecionáveis' },
          { id: `${settings.prefix}missao`, title: '🌸 Estrelas do dia', description: 'Objetivos e recompensas' },
          { id: `${settings.prefix}ouro`, title: '💮 Ouro e mineração', description: 'Saldo de ouro, picareta e conversão' },
          { id: `${settings.prefix}pvp`, title: '🌸 Arena PVP', description: 'Desafios, estatísticas e histórico' },
          { id: `${settings.prefix}investimentos`, title: '🌸 Investimentos', description: 'Aplicações, prazos e resgates' }
        ]
      },
      {
        title: '💮 Rotina',
        rows: [
          { id: `${settings.prefix}rotina`, title: '💮 Colheita diária', description: 'Turnos e recompensas do dia' },
          { id: `${settings.prefix}caixadiaria`, title: '🌸 Caixa diária', description: 'Uma caixa especial por dia' },
          { id: `${settings.prefix}minerar`, title: '💮 Minerar ouro', description: 'Use sua picareta na Mina Sakura' },
          { id: `${settings.prefix}jornada`, title: '💮 Jornadas', description: 'Escolha um caminho para explorar' },
          { id: `${settings.prefix}oficio`, title: '💮 Ofícios', description: 'Troque sua ocupação' }
        ]
      },
      {
        title: '🌸 Sakura Coins',
        rows: [
          { id: `${settings.prefix}banco`, title: '🌸 Cofre Sakura', description: 'Guardar, retirar e colher rendimento' },
          { id: `${settings.prefix}loja`, title: '🌸 Vitrine Sakura', description: 'Itens, materiais e raridades' },
          { id: `${settings.prefix}minhaloja`, title: '🌸 Minha loja', description: 'Anúncios e vendas para membros' },
          { id: `${settings.prefix}pets`, title: '🌸 Pets Sakura', description: 'Coleção, evolução e bônus moderados' },
          { id: `${settings.prefix}casa`, title: '🌸 Casa Sakura', description: 'Moradia, melhorias e descanso' },
          { id: `${settings.prefix}atelier`, title: '🌸 Ateliê Sakura', description: 'Transformar materiais em itens especiais' },
          { id: `${settings.prefix}sorte 100`, title: '🌸 Estrela da Sorte', description: 'Uma rodada usando 100 Sakura Coins' }
        ]
      }
    ]
  })
}

export async function sendBalance({ sock, msg, account, number, logger }) {
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-balance',
    title: 'CONTA SAKURA',
    body: accountLines(account, number).join('\n'),
    buttonText: '💮 Ações da conta',
    sections: [
      {
        title: '💮 Acesso rápido',
        rows: [
          { id: `${settings.prefix}banco`, title: '🌸 Abrir cofre', description: 'Guardar ou retirar Sakura Coins' },
          { id: `${settings.prefix}extrato`, title: '🌸 Ver memórias', description: 'Últimos movimentos da conta' },
          { id: `${settings.prefix}missao`, title: '🌸 Ver estrelas', description: 'Objetivos do dia' },
          { id: `${settings.prefix}atelier`, title: '🌸 Abrir ateliê', description: 'Criar itens com materiais' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendProfile({ sock, msg, account, number, jid = '', displayName = '', image = null, vip = false, device = 'unknown', mentions = [], logger }) {
  const digits = String(number || '').replace(/\D/g, '')
  const fullPhone = digits ? `+${digits}` : 'indisponível'
  const system = ({
    android: 'Android',
    ios: 'iOS',
    web: 'WhatsApp Web',
    desktop: 'Desktop',
    unknown: 'não disponível'
  })[String(device || 'unknown').toLowerCase()] || 'não disponível'
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-profile',
    title: 'PERFIL',
    image: image?.buffer ? image : null,
    mentions,
    body: [
      `🌸 *nome:* ${displayName || 'não disponível'}`,
      `🌸 *número:* ${fullPhone}`,
      `🌸 *sistema:* ${system}`,
      `🌸 *plano:* ${vip ? 'Sakura VIP' : 'gratuito'}`
    ].join('\n'),
    buttonText: '🌸 Ações do perfil',
    sections: [
      {
        title: '🌸 Perfil',
        rows: [
          { id: `${settings.prefix}pf ${digits}`, title: '🌸 Atualizar perfil', description: 'Consultar novamente os dados essenciais' },
          { id: `${settings.prefix}saldo`, title: `🌸 Ver ${settings.currencyName}`, description: 'Abrir saldo e conta econômica' },
          { id: `${settings.prefix}m eco`, title: '💮 Menu de economia', description: 'Abrir comandos econômicos' }
        ]
      }
    ]
  })
}

export async function sendRoutine({ sock, msg, account, logger }) {
  const job = getJobs()[account.job] || getJobs().florista
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-routine',
    title: 'ROTINA SAKURA',
    body: [
      `💮 *sequência:* ${account.streak || 0} dias`,
      `💮 *ofício atual:* ${job.icon} ${job.name}`,
      '🌸 Escolha sua próxima ação:'
    ].join('\n'),
    buttonText: '💮 Escolher ação',
    sections: [
      {
        title: '💮 Agora',
        rows: [
          { id: `${settings.prefix}diario`, title: '💮 Colher Sakura Coins', description: 'Recompensa diária e sequência' },
          { id: `${settings.prefix}trabalhar`, title: `${job.icon} Fazer turno`, description: `Atuar como ${job.name}` },
          { id: `${settings.prefix}jornada`, title: '💮 Seguir jornada', description: 'Explorar outros caminhos' },
          { id: `${settings.prefix}missao`, title: '🌸 Ver estrelas', description: 'Objetivos atuais' }
        ]
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}oficio`, title: '💮 Trocar ofício', description: 'Escolher outra ocupação' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendJobs({ sock, msg, account, logger }) {
  const jobs = getJobs()
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-jobs',
    title: 'OFÍCIOS SAKURA',
    body: `💮 *ofício atual:* ${jobs[account.job]?.icon || '💮'} ${jobs[account.job]?.name || 'Florista'}\n💮 Escolha o ritmo que combina com você.`,
    buttonText: '💮 Escolher ofício',
    sections: [
      {
        title: '💮 Ofícios disponíveis',
        rows: Object.entries(jobs).map(([id, job]) => ({
          id: `${settings.prefix}oficio ${id}`,
          title: `${job.icon} ${job.name}`,
          description: `${money(job.min)}–${money(job.max)} • ${duration(job.wait)}`
        }))
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}rotina`, title: '💮 Abrir rotina', description: 'Voltar às ações diárias' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendBank({ sock, msg, account, logger }) {
  const halfWallet = Math.floor(account.wallet / 2)
  const halfBank = Math.floor(account.bank / 2)
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-bank',
    title: 'COFRE SAKURA',
    body: `💮 *carteira:* ${money(account.wallet)}\n💮 *cofre:* ${money(account.bank)}\n🌸 Movimente suas Sakura Coins com um toque.`,
    buttonText: '🌸 Movimentar',
    sections: [
      {
        title: '💮 Guardar',
        rows: [
          ...(halfWallet > 0 ? [{ id: `${settings.prefix}depositar ${halfWallet}`, title: '💮 Guardar metade', description: money(halfWallet) }] : []),
          ...(account.wallet > 0 ? [{ id: `${settings.prefix}depositar tudo`, title: '💮 Guardar tudo', description: money(account.wallet) }] : []),
          { id: `${settings.prefix}rendimento`, title: '🌸 Colher rendimento', description: 'Uma vez por dia' }
        ]
      },
      {
        title: '💮 Retirar',
        rows: [
          ...(halfBank > 0 ? [{ id: `${settings.prefix}sacar ${halfBank}`, title: '🌸 Retirar metade', description: money(halfBank) }] : []),
          ...(account.bank > 0 ? [{ id: `${settings.prefix}sacar tudo`, title: '💮 Retirar tudo', description: money(account.bank) }] : []),
          { id: `${settings.prefix}extrato`, title: '🌸 Memórias da conta', description: 'Ver movimentos recentes' }
        ]
      },
      {
        title: '🌸 Navegação',
        rows: [
          { id: `${settings.prefix}saldo`, title: '💮 Minha conta', description: 'Ver saldo e progresso' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendJourney({ sock, msg, account, logger }) {
  const actions = getActions()
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-journey',
    title: 'JORNADAS SAKURA',
    body: `💮 *nível:* ${account.level} — ${rankName(account.level)}\n💮 Cada caminho guarda Sakura Coins, XP, ouro e surpresas.`,
    buttonText: '💮 Escolher caminho',
    sections: [
      {
        title: '💮 Caminhos disponíveis',
        rows: [
          { id: `${settings.prefix}minerar`, title: '💮 Mina Sakura', description: 'Extrair ouro, XP, Sakura Coins e materiais' },
          ...Object.entries(actions).map(([id, action]) => ({
            id: `${settings.prefix}${id}`,
            title: `${action.icon} ${action.name}`,
            description: `${money(action.min)}–${money(action.max)} • ${duration(action.wait)}`
          }))
        ]
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}rotina`, title: '💮 Abrir rotina', description: 'Ver ações do dia' },
          { id: `${settings.prefix}missao`, title: '🌸 Ver estrelas', description: 'Acompanhar missões' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendShop({ sock, msg, account, logger }) {
  const items = getShop()
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-shop',
    title: 'VITRINE SAKURA',
    body: `💮 *carteira:* ${money(account.wallet)}\n💮 Escolha um item para levar à mochila.`,
    buttonText: '🌸 Abrir vitrine',
    sections: [
      {
        title: '💮 Itens e materiais',
        rows: Object.entries(items).map(([id, item]) => ({
          id: `${settings.prefix}comprar ${id}`,
          title: `${item.icon} ${item.name} — ${money(item.price)}`,
          description: item.description.slice(0, 70)
        }))
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}mochila`, title: '🌸 Abrir mochila', description: 'Ver itens comprados' },
          { id: `${settings.prefix}atelier`, title: '🌸 Abrir ateliê', description: 'Usar materiais em criações' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendInventory({ sock, msg, account, inventory, logger }) {
  const rows = inventory.flatMap(item => [
    {
      id: item.kind === 'material' ? `${settings.prefix}atelier` : `${settings.prefix}usar ${item.id}`,
      title: `${item.icon} ${item.name} x${item.quantity}`,
      description: item.kind === 'material' ? 'Material do Ateliê Sakura' : item.description.slice(0, 70)
    },
    { id: `${settings.prefix}vender ${item.id}`, title: `💮 Vender 1 ${item.name}`, description: `Receber ${money(item.sell)}` }
  ])
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-inventory',
    title: 'MOCHILA SAKURA',
    body: inventory.length
      ? `💮 *itens diferentes:* ${inventory.length}\n💮 *carteira:* ${money(account.wallet)}\n🌸 Toque em um item para usar ou vender.`
      : `💮 Sua mochila está vazia.\n💮 Visite a vitrine para encontrar itens.`,
    buttonText: '🌸 Abrir mochila',
    sections: [
      {
        title: '💮 Conteúdo',
        rows: rows.length ? rows : [{ id: `${settings.prefix}loja`, title: '🌸 Visitar vitrine', description: 'Encontrar itens Sakura' }]
      },
      {
        title: '🌸 Navegação',
        rows: [
          { id: `${settings.prefix}atelier`, title: '🌸 Abrir Ateliê Sakura', description: 'Combinar materiais da mochila' },
          { id: `${settings.prefix}loja`, title: '🌸 Abrir Vitrine Sakura', description: 'Comprar novos itens e materiais' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}


export async function sendWorkshop({ sock, msg, account, inventory, logger }) {
  const recipes = getRecipes()
  const amounts = Object.fromEntries((inventory || []).map(item => [item.id, item.quantity]))
  const shop = getShop()
  const rows = Object.entries(recipes).map(([id, recipe]) => {
    const requirements = Object.entries(recipe.needs).map(([itemId, quantity]) => {
      const item = shop[itemId] || { name: itemId, icon: '🌸' }
      return `${item.icon}${amounts[itemId] || 0}/${quantity}`
    }).join(' • ')
    const ready = Object.entries(recipe.needs).every(([itemId, quantity]) => Number(amounts[itemId] || 0) >= quantity)
    return {
      id: ready ? `${settings.prefix}criar ${id}` : `${settings.prefix}loja`,
      title: `${ready ? '🌸' : '🌸'} ${recipe.icon} ${recipe.name}`,
      description: `${requirements}${ready ? ' • pronto para criar' : ' • faltam materiais'}`.slice(0, 72)
    }
  })
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-workshop',
    title: 'ATELIÊ SAKURA',
    body: `💮 *carteira:* ${money(account.wallet)}\n💮 Combine materiais da mochila e crie raridades.`,
    buttonText: '🌸 Abrir bancada',
    sections: [
      { title: '💮 Criações disponíveis', rows },
      {
        title: '💮 Materiais',
        rows: [
          { id: `${settings.prefix}loja`, title: '🌸 Buscar materiais', description: 'Galhos, fitas, cristais e Sakura Coins douradas' },
          { id: `${settings.prefix}mochila`, title: '🌸 Ver mochila', description: 'Conferir tudo que está guardado' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendMissions({ sock, msg, missions, logger }) {
  const rows = missions.items.map(quest => {
    const ready = quest.progress >= quest.target && !quest.claimed
    const state = quest.claimed ? 'concluída' : ready ? 'prêmio pronto' : `${quest.progress}/${quest.target}`
    return {
      id: ready ? `${settings.prefix}missao claim ${quest.id}` : `${settings.prefix}missao`,
      title: `${quest.claimed ? '💮' : ready ? '🌸' : '💮'} ${quest.label}`,
      description: `${state} • ${money(quest.reward)}`
    }
  })
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-missions',
    title: 'ESTRELAS DO DIA',
    body: '💮 Três pequenos caminhos renovados diariamente.\n💮 Complete e toque no prêmio quando ele brilhar.',
    buttonText: '🌸 Ver estrelas',
    sections: [
      { title: '💮 Missões atuais', rows },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}rotina`, title: '💮 Abrir rotina', description: 'Cumprir ações do dia' },
          { id: `${settings.prefix}conquistas`, title: '💮 Memórias raras', description: 'Ver conquistas permanentes' },
          { id: `${settings.prefix}eco`, title: '🌸 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendAchievements({ sock, msg, achievements, logger }) {
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-achievements',
    title: 'MEMÓRIAS RARAS',
    body: '💮 Marcas especiais da sua jornada no Jardim Sakura.',
    buttonText: '💮 Ver memórias',
    sections: [
      {
        title: '💮 Coleção',
        rows: achievements.map(item => ({
          id: `${settings.prefix}saldo`,
          title: `${item.unlocked ? '💮' : '🌸'} ${item.icon} ${item.name}`,
          description: `${item.unlocked ? 'desbloqueada' : 'ainda oculta'} • ${money(item.reward)}`
        }))
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}missao`, title: '🌸 Estrelas do dia', description: 'Ver missões renovadas diariamente' },
          { id: `${settings.prefix}saldo`, title: '💮 Minha conta', description: 'Ver nível e progresso' },
          { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendStatement({ sock, msg, entries, account, logger }) {
  const iconFor = direction => direction === 'in' ? '💮' : direction === 'out' ? '💮' : '🌸'
  const rows = entries.map(entry => ({
    id: `${settings.prefix}saldo`,
    title: `${iconFor(entry.direction)} ${entry.direction === 'out' ? '-' : entry.direction === 'in' ? '+' : '🌸'}${money(entry.amount)}`,
    description: `${entry.note || entry.type} • ${new Date(entry.at).toLocaleString('pt-BR', { timeZone: 'America/Recife' })}`.slice(0, 72)
  }))
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-statement',
    title: 'MEMÓRIAS DA CONTA',
    body: `💮 *carteira:* ${money(account.wallet)}\n💮 *cofre:* ${money(account.bank)}\n🌸 Últimos movimentos registrados.`,
    buttonText: '🌸 Ver movimentos',
    sections: [
      {
        title: '💮 Mais recentes',
        rows: rows.length ? rows : [{ id: `${settings.prefix}rotina`, title: '💮 Nenhuma memória ainda', description: 'Comece pela rotina Sakura' }]
      },
      {
        title: '💮 Navegação',
        rows: [
          { id: `${settings.prefix}saldo`, title: '💮 Minha conta', description: 'Ver saldo e progresso' },
          { id: `${settings.prefix}banco`, title: '🌸 Abrir cofre', description: 'Guardar ou retirar Sakura Coins' },
          { id: `${settings.prefix}eco`, title: '🌸 Voltar ao jardim', description: 'Painel principal da economia' }
        ]
      }
    ]
  })
}

export async function sendTransferConfirmation({ sock, msg, pending, logger }) {
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-transfer-confirm',
    title: 'PIX SAKURA',
    body: `💮 *destino:* ${shortNumber(pending.to)}\n💮 *valor:* ${money(pending.amount)}\n🌸 Confirme em até 2 minutos.`,
    buttonText: '🌸 Confirmar movimento',
    sections: [{
      title: '💮 Confirmação',
      rows: [
        { id: `${settings.prefix}pixconfirm ${pending.id}`, title: '💮 Confirmar PIX', description: `Enviar ${money(pending.amount)}` },
        { id: `${settings.prefix}pixcancel ${pending.id}`, title: '💮 Cancelar', description: 'Não movimentar a conta' }
      ]
    }]
  })
}


export async function sendMiningPanel({ sock, msg, status, logger }) {
  const { account, pickaxe, left, rate } = status
  const next = Object.values(getPickaxes()).find(item => item.level === pickaxe.level + 1)
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-mining',
    title: 'MINA SAKURA',
    body: [
      `💮 *ouro atual:* ${Number(account.gold || 0).toLocaleString('pt-BR')}`,
      `💮 *picareta:* ${pickaxe.icon} ${pickaxe.name}`,
      `🌸 *multiplicador:* ${pickaxe.multiplier.toFixed(2)}x`,
      `🌸 *minerações:* ${Number(account.mining?.sessions || 0)}`,
      `💮 *ouro total minerado:* ${Number(account.mining?.totalGold || 0).toLocaleString('pt-BR')}`,
      left > 0 ? `💮 *mina disponível em:* ${duration(left)}` : '💮 *mina:* disponível agora',
      `🌸 *cotação:* 1 ouro = ${rate} Sakura Coins`
    ].join('\n'),
    buttonText: '💮 Abrir mina',
    sections: [
      {
        title: '💮 Mineração',
        rows: [
          { id: `${settings.prefix}minerar`, title: '💮 Minerar agora', description: left > 0 ? `Disponível em ${duration(left)}` : 'Coletar ouro e materiais' },
          { id: `${settings.prefix}trocarouro tudo`, title: '💮 Trocar todo o ouro', description: `${Number(account.gold || 0)} ouro por Sakura Coins` },
          { id: `${settings.prefix}picareta`, title: '🌸 Ver picareta', description: next ? `Próxima: ${next.name}` : 'Picareta no nível máximo' }
        ]
      },
      {
        title: '🌸 Rankings',
        rows: [
          { id: `${settings.prefix}rankouro`, title: '💮 Mais ouro', description: 'Ranking de ouro disponível' },
          { id: `${settings.prefix}rankmineracao`, title: '💮 Mais mineração', description: 'Ouro total extraído' },
          { id: `${settings.prefix}rankpicareta`, title: '🌸 Melhores picaretas', description: 'Nível e produção' }
        ]
      }
    ]
  })
}

function costDescription(cost = {}) {
  const parts = []
  if (cost.petals) parts.push(money(cost.petals))
  if (cost.gold) parts.push(`${cost.gold} ouro`)
  const shop = getShop()
  for (const [id, quantity] of Object.entries(cost.items || {})) parts.push(`${quantity}x ${shop[id]?.name || id}`)
  return parts.join(' • ') || 'sem custo'
}

export async function sendPickaxePanel({ sock, msg, account, logger }) {
  const pickaxes = Object.values(getPickaxes()).sort((a, b) => a.level - b.level)
  const current = getPickaxes()[account.pickaxe] || getPickaxes().madeira
  const next = pickaxes.find(item => item.level === current.level + 1)
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-pickaxe',
    title: 'PICARETAS SAKURA',
    body: [
      `💮 *atual:* ${current.icon} ${current.name}`,
      `🌸 *nível:* ${current.level}/${pickaxes.length}`,
      `🌸 *bônus:* ${current.multiplier.toFixed(2)}x`,
      `💮 *ouro:* ${Number(account.gold || 0).toLocaleString('pt-BR')}`,
      next ? `🌸 *próxima:* ${next.name}\n🌸 *custo:* ${costDescription(next.cost)}` : '💮 *nível máximo alcançado*'
    ].join('\n'),
    buttonText: '🌸 Abrir picaretas',
    sections: [
      {
        title: '💮 Minha picareta',
        rows: [
          ...(next ? [{ id: `${settings.prefix}melhorarpicareta`, title: `🌸 Melhorar para ${next.name}`, description: costDescription(next.cost).slice(0, 72) }] : []),
          { id: `${settings.prefix}minerar`, title: '💮 Minerar ouro', description: 'Usar a picareta atual' },
          { id: `${settings.prefix}ouro`, title: '💮 Abrir painel do ouro', description: 'Saldo, cotação e estatísticas' }
        ]
      },
      {
        title: '🌸 Progressão',
        rows: pickaxes.map(item => ({
          id: `${settings.prefix}picareta`,
          title: `${item.level <= current.level ? '💮' : '🌸'} ${item.icon} ${item.name}`,
          description: item.cost ? costDescription(item.cost).slice(0, 72) : item.description.slice(0, 72)
        }))
      }
    ]
  })
}

export async function sendDailyBoxPanel({ sock, msg, account, logger }) {
  const available = account.lastDailyBox !== new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return sendList({
    sock,
    msg,
    logger,
    kind: 'economy-daily-box',
    title: 'CAIXA DIÁRIA',
    body: [
      available ? '🌸 *status:* disponível agora' : '💮 *status:* já aberta hoje',
      `💮 *ouro:* ${Number(account.gold || 0).toLocaleString('pt-BR')}`,
      `💮 *carteira:* ${money(account.wallet)}`,
      '🌸 A caixa pode trazer Sakura Coins, ouro e materiais raros.'
    ].join('\n'),
    buttonText: '🌸 Abrir caixa',
    sections: [{
      title: '🌸 Recompensa diária',
      rows: [
        { id: `${settings.prefix}caixadiaria abrir`, title: available ? '🌸 Abrir agora' : '💮 Voltar amanhã', description: available ? 'Receber uma recompensa aleatória' : 'Uma abertura por dia' },
        { id: `${settings.prefix}ouro`, title: '💮 Ver ouro', description: 'Saldo, mineração e conversão' },
        { id: `${settings.prefix}eco`, title: '💮 Voltar ao jardim', description: 'Painel principal da economia' }
      ]
    }]
  })
}
