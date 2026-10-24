import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'

export default defineCommand({
  name: 'botinfo',
  aliases: ['bi', 'info', 'planosaluguel', 'pa', 'conectar', 'cn'],
  menuEntries: [
    { name: 'botinfo', usage: '.botinfo', description: 'Mostra identidade, versão e runtime da Sakura.', menuGroup: 'Informações' },
    { name: 'planosaluguel', usage: '.planosaluguel', description: 'Mostra informações de aluguel.', menuGroup: 'Informações' },
    { name: 'conectar', usage: '.conectar', description: 'Mostra como a conexão é gerenciada.', menuGroup: 'Configuração' }
  ],
  category: 'Principal',
  usage: '.botinfo',
  description: 'Mostra a identidade e informações técnicas da Sakura-MD.',
  async execute({ sock, msg, text, settings, isOwner, logger }) {
    const used = text.slice(settings.prefix.length).trim().split(/\s+/)[0].toLowerCase()
    const bodies = {
      planosaluguel: `aluguel: consulte ${settings.ownerName} para ativar a Sakura em outro grupo`,
      conectar: 'conexão: sessão gerenciada automaticamente pela Sakura'
    }
    const body = bodies[used] || [
      `codinome: ${settings.codename || 'Hanami'}`,
      `versão: ${settings.release}`,
      `prefixo: ${settings.prefix}`,
      `runtime: Node.js ${process.version}`,
      `número: ${settings.botNumber ? `+${settings.botNumber}` : 'detectado ao conectar'}`
    ].join('\n')
    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: `info:${used || 'botinfo'}`,
      body: formatMessage(body, { title: 'Info' }),
      buttonText: '💮 Abrir informações',
      sections: [{ title: '🌸 Informações', rows: [
        { id: `${settings.prefix}botinfo`, title: '💮 Identidade do bot', description: 'Codinome, versão e runtime' },
        { id: `${settings.prefix}dono list`, title: '🌸 Donos', description: 'Hierarquia e administradores principais' },
        { id: `${settings.prefix}config`, title: '💮 Configurações', description: 'Painel central da Sakura' },
        { id: `${settings.prefix}conectar`, title: '🌸 Conexão', description: 'Sessão e autenticação' }
      ]}]
    })
  }
})
