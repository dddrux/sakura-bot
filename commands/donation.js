import { defineCommand } from '../data/workstation.js'
import { firstTargetNumber } from '../data/targets.js'
import { reply } from '../data/reply.js'
import { setVipDuration } from '../data/vip.js'
import { settings } from '../data/settings.js'

const DEFAULT_PIX = '5581999434137'
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function tierFor(amount) {
  return [...(settings.donationTiers || [])].filter(tier => amount >= Number(tier.minAmount || 0)).sort((a, b) => Number(b.minAmount || 0) - Number(a.minAmount || 0))[0] || null
}

function donationText() {
  const tiers = (settings.donationTiers || []).map(tier => {
    const plan = (settings.vipPlans || []).find(item => item.key === tier.plan)
    return `${money(tier.minAmount)}+ — ${plan?.name || tier.plan} por ${tier.days} dias`
  })
  return [
    `pix: ${settings.donationPix || DEFAULT_PIX}`,
    `nome: ${settings.donationName}`,
    'apoios podem liberar benefícios VIP conforme o valor',
    ...tiers
  ].join('\n')
}

export default defineCommand({
  name: 'doar',
  aliases: ['doacao', 'apoia', 'doarpix'],
  category: 'VIP',
  usage: '.doar',
  description: 'Mostra o PIX oficial e os benefícios por apoio.',
  async execute({ sock, msg, args, rawArgs, senderNumber, role }) {
    const action = normalize(args[0])
    if (['registrar', 'reg'].includes(action)) {
      if (!['owner', 'subowner'].includes(String(role || ''))) return reply(sock, msg, 'Apenas dono ou subdono pode registrar uma doação.')
      const amount = Number(String(args[1] || '').replace(',', '.'))
      const target = firstTargetNumber(msg, args.slice(2)) || senderNumber
      if (!Number.isFinite(amount) || amount <= 0 || !target) return reply(sock, msg, `Use ${settings.prefix}doacao registrar 10 @pessoa.`)
      const tier = tierFor(amount)
      if (!tier) return reply(sock, msg, 'Valor registrado, mas ainda sem faixa de benefício VIP.')
      const row = await setVipDuration(target, { ms: Number(tier.days) * 86_400_000 }, senderNumber, { mode: 'renew', plan: tier.plan })
      const plan = (settings.vipPlans || []).find(item => item.key === tier.plan)
      return reply(sock, msg, `doação: ${money(amount)}\nbenefício: ${plan?.name || tier.plan}\nduração: ${tier.days} dias\nusuário: +${target}`, { title: 'APOIO SAKURA' })
    }

    return reply(sock, msg, donationText(), {
      title: 'APOIE A SAKURA',
      nativeFlow: [
        { text: '🪙 Copiar PIX', copy: settings.donationPix || DEFAULT_PIX }, // compilado pelo Baileys como cta_copy
        { text: '💮 Ver planos VIP', quickReply: { id: `${settings.prefix}vip planos`, displayText: '💮 Ver planos VIP' } }
      ]
    })
  }
})
