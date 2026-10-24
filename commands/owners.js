import { defineCommand } from '../data/workstation.js'
import { addSubowner, listSubowners, removeSubowner, writeAudit } from '../data/core-store.js'
import { resolveTargetNumber } from '../data/targets.js'
import { isConnectedSelf } from '../data/superuser.js'
import { readConfig, settings as globalSettings, writeConfigSync } from '../data/settings.js'
import { reply } from '../data/reply.js'

const digits = value => String(value || '').replace(/\D/g, '')
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function mainOwner(config = readConfig()) {
  return config.owners.find(row => row.enabled !== false && row.role === 'owner') || config.owners.find(row => row.enabled !== false) || null
}


function syncOwners(owners) {
  const current = readConfig()
  const next = writeConfigSync({ owners, bot: current.bot })
  globalSettings.owners = next.owners
  const primary = mainOwner(next)
  if (primary) {
    globalSettings.ownerNumber = digits(primary.number)
    globalSettings.ownerName = String(primary.name || 'Dono')
  }
  return next.owners
}

function canChangeOwners({ sock, msg, senderNumber }) {
  if (isConnectedSelf({ sock, fromMe: Boolean(msg?.key?.fromMe), senderNumber, botNumber: globalSettings.botNumber })) return true
  return digits(senderNumber) === digits(mainOwner()?.number)
}

export default defineCommand({
  name: 'dono',
  aliases: ['donos', 'owner', 'owners', 'subdono', 'subdonos', 'adddono', 'addono', 'deldono', 'addsubdono', 'delsubdono'],
  menuEntries: [
    { name: 'dono', usage: '.dono list', description: 'Lista ou gerencia donos da Sakura.', menuGroup: 'Dono' },
    { name: 'subdono', usage: '.subdono list', description: 'Lista ou gerencia subdonos.', menuGroup: 'Dono' }
  ],
  category: 'Dono',
  usage: '.dono add @pessoa',
  description: 'Gerencia donos e subdonos pelo WhatsApp.',
  ownerOnly: true,
  subownerAllowed: false,
  async execute({ sock, msg, args, text, settings, senderNumber }) {
    const invoked = normalize(String(text || '').slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const mode = invoked.includes('subdono') ? 'subdono' : 'dono'
    const implicit = invoked.startsWith('add') ? 'add' : invoked.startsWith('del') ? 'del' : ''
    const action = implicit || normalize(args[0] || 'list')
    const values = implicit ? args : args.slice(1)

    if (mode === 'dono') {
      const config = readConfig()
      const owners = config.owners.filter(row => row.enabled !== false && row.role === 'owner')
      if (['list', 'lista', 'listar', 'status'].includes(action)) {
        const body = owners.length ? owners.map((row, i) => `${i + 1}. ${row.name || 'Dono'} • +${digits(row.number)}`).join('\n') : 'Nenhum dono ativo.'
        return reply(sock, msg, body, { title: 'DONOS' })
      }
      if (!['add', 'adicionar', 'del', 'delete', 'remover', 'remove'].includes(action)) {
        return reply(sock, msg, [`${settings.prefix}dono add @pessoa`, `${settings.prefix}dono del @pessoa`, `${settings.prefix}dono list`].join('\n'), { title: 'DONOS' })
      }
      if (!canChangeOwners({ sock, msg, senderNumber })) return reply(sock, msg, 'Somente a própria Sakura ou o dono principal pode alterar a lista de donos.')
      const number = await resolveTargetNumber(sock, msg, values)
      if (!number) return reply(sock, msg, `Marque/responda alguém ou use ${settings.prefix}dono add 5511999999999.`)
      const primary = mainOwner(config)
      if (['del', 'delete', 'remover', 'remove'].includes(action) && digits(primary?.number) === number) return reply(sock, msg, 'O dono principal não pode ser removido pelo WhatsApp.')
      let next = [...config.owners]
      if (['add', 'adicionar'].includes(action)) {
        const existing = next.find(row => digits(row.number) === number)
        if (existing) { existing.role = 'owner'; existing.enabled = true; existing.name ||= `Dono ${next.length + 1}` }
        else next.push({ name: `Dono ${owners.length + 1}`, number, role: 'owner', enabled: true })
        syncOwners(next)
        writeAudit({ actor: senderNumber, action: 'owner.add', target: number })
        return reply(sock, msg, `Dono adicionado: @${number}.`, { title: 'DONOS', mentions: [`${number}@s.whatsapp.net`] })
      }
      next = next.filter(row => !(digits(row.number) === number && row.role === 'owner'))
      syncOwners(next)
      writeAudit({ actor: senderNumber, action: 'owner.remove', target: number })
      return reply(sock, msg, `Dono removido: @${number}.`, { title: 'DONOS', mentions: [`${number}@s.whatsapp.net`] })
    }

    if (['list', 'lista', 'listar', 'status'].includes(action)) {
      const rows = listSubowners()
      const mentions = rows.map(row => `${digits(row.number)}@s.whatsapp.net`)
      return reply(sock, msg, rows.length ? rows.map((row, i) => `${i + 1}. @${digits(row.number)}`).join('\n') : 'Nenhum subdono ativo.', { title: 'SUBDONOS', mentions })
    }
    if (!['add', 'adicionar', 'del', 'delete', 'remover', 'remove'].includes(action)) {
      return reply(sock, msg, [`${settings.prefix}subdono add @pessoa`, `${settings.prefix}subdono del @pessoa`, `${settings.prefix}subdono list`].join('\n'), { title: 'SUBDONOS' })
    }
    const number = await resolveTargetNumber(sock, msg, values)
    if (!number) return reply(sock, msg, `Marque/responda alguém ou use ${settings.prefix}subdono add 5511999999999.`)
    if (digits(mainOwner()?.number) === number) return reply(sock, msg, 'O dono principal não pode virar subdono.')
    if (['add', 'adicionar'].includes(action)) {
      addSubowner(number, senderNumber)
      return reply(sock, msg, `Subdono adicionado: @${number}.`, { title: 'SUBDONOS', mentions: [`${number}@s.whatsapp.net`] })
    }
    const removed = removeSubowner(number, senderNumber)
    return reply(sock, msg, removed ? `Subdono removido: @${number}.` : 'Essa pessoa não era subdono ativo.', { title: 'SUBDONOS', mentions: removed ? [`${number}@s.whatsapp.net`] : [] })
  }
})
