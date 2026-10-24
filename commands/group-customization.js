import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { targetCandidates } from '../data/targets.js'
import { updateGroupParticipant, promoteGroupParticipant } from '../data/group-admin.js'
import path from 'node:path'
import { prepareLegacyAudio } from '../data/legacy-audio.js'
import { sendAudioMedia } from '../data/media-delivery.js'
import { settings as botSettings } from '../data/settings.js'

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

async function sendPromotedAudio(sock, msg, logger) {
  const file = path.join(botSettings.audioDir, 'legacy', 'promovido.mp3')
  try {
    const audio = await prepareLegacyAudio(file, logger)
    await sendAudioMedia(sock, msg, audio, {
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus',
      priority: 'high'
    })
    logger?.info?.({ stage: 'promote-audio', bytes: audio.length }, 'áudio de promovido enviado')
    return true
  } catch (error) {
    logger?.warn?.({ error, stage: 'promote-audio' }, 'áudio promovido não pôde ser enviado')
    return false
  }
}

async function panel({ sock, msg, settings, logger }) {
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'group-customization',
    body: '🌸 *CENTRAL DO GRUPO*\n🌸 Administração, aparência e membros em um só lugar.',
    buttonText: '🌸 Gerenciar grupo',
    sections: [
      { title: '🌸 Estado do grupo', rows: [
        { id: `${settings.prefix}grupoabrir`, title: '🌸 Abrir grupo', description: 'Todos podem enviar mensagens' },
        { id: `${settings.prefix}grupofechar`, title: '🌸 Fechar grupo', description: 'Somente admins enviam mensagens' },
        { id: `${settings.prefix}linkgrupo`, title: '💮 Link do grupo', description: 'Mostra o convite atual' }
      ]},
      { title: '🌸 Aparência', rows: [
        { id: `${settings.prefix}mudarnome Novo nome`, title: '🌸 Mudar nome', description: 'Troca o nome do grupo' },
        { id: `${settings.prefix}mudardesc Nova descrição`, title: '🌸 Mudar descrição', description: 'Troca a descrição do grupo' }
      ]},
      { title: '💮 Membros', rows: [
        { id: `${settings.prefix}promover @pessoa`, title: '🌸 Promover', description: 'Torna a pessoa administradora' },
        { id: `${settings.prefix}rebaixar @pessoa`, title: '🌸 Rebaixar', description: 'Remove o cargo de administrador' },
        { id: `${settings.prefix}remover @pessoa`, title: '💮 Remover', description: 'Remove a pessoa do grupo' }
      ]}
    ]
  })
}

export default defineCommand({
  name: 'grupo',
  aliases: ['grupopainel','grupoabrir','grupofechar','abrirgrupo','abrirgp','fechargrupo','fechargp','mudarnome','nomegrupo','nomegp','mudardesc','descgrupo','descgp','linkgrupo','linkgp','promover','promote','rebaixar','demote','remover','kick'],
  category: 'Administração', groupOnly: true, adminOnly: true, strictAdminOnly: true, botAdminOnly: true,
  usage: '.grupo', description: 'Central moderna de administração e customização do grupo.',
  menuEntries: [
    { name:'grupo', usage:'.grupo', description:'Abre a central de administração.', menuGroup:'Central' },
    { name:'grupoabrir', usage:'.grupoabrir', description:'Abre o grupo para mensagens.', menuGroup:'Estado' },
    { name:'grupofechar', usage:'.grupofechar', description:'Fecha o grupo para membros.', menuGroup:'Estado' },
    { name:'mudarnome', usage:'.mudarnome Novo nome', description:'Muda o nome do grupo.', menuGroup:'Aparência' },
    { name:'mudardesc', usage:'.mudardesc Nova descrição', description:'Muda a descrição do grupo.', menuGroup:'Aparência' },
    { name:'promover', usage:'.promover @pessoa', description:'Promove um membro.', menuGroup:'Membros' },
    { name:'rebaixar', usage:'.rebaixar @pessoa', description:'Rebaixa um administrador.', menuGroup:'Membros' },
    { name:'remover', usage:'.remover @pessoa', description:'Remove um membro.', menuGroup:'Membros' }
  ],
  slash: { model: '.grupo', categories: ['grupo','administração','customização'], copyable: true },
  async execute({ sock, msg, args, invokedAs, settings, logger, metadata }) {
    const used = norm(invokedAs)
    if (['grupo','grupopainel'].includes(used)) return panel({ sock, msg, settings, logger })
    if (['grupoabrir','abrirgrupo','abrirgp'].includes(used)) { await sock.groupSettingUpdate(msg.key.remoteJid, 'not_announcement'); return reply(sock,msg,'Grupo aberto para mensagens.',{title:'GRUPO'}) }
    if (['grupofechar','fechargrupo','fechargp'].includes(used)) { await sock.groupSettingUpdate(msg.key.remoteJid, 'announcement'); return reply(sock,msg,'Grupo fechado para membros.',{title:'GRUPO'}) }
    if (['mudarnome','nomegrupo','nomegp'].includes(used)) { const name=args.join(' ').trim().slice(0,100); if(!name)return reply(sock,msg,'Informe o novo nome.'); await sock.groupUpdateSubject(msg.key.remoteJid,name); return reply(sock,msg,'Nome do grupo atualizado.',{title:'GRUPO'}) }
    if (['mudardesc','descgrupo','descgp'].includes(used)) { const description=args.join(' ').trim().slice(0,2048); if(!description)return reply(sock,msg,'Informe a nova descrição.'); await sock.groupUpdateDescription(msg.key.remoteJid,description); return reply(sock,msg,'Descrição do grupo atualizada.',{title:'GRUPO'}) }
    if (['linkgrupo','linkgp'].includes(used)) { const code=await sock.groupInviteCode(msg.key.remoteJid); return reply(sock,msg,`https://chat.whatsapp.com/${code}`,{title:'LINK DO GRUPO'}) }
    if (['promover','promote','rebaixar','demote','remover','kick'].includes(used)) {
      const candidates = targetCandidates(msg, args)
      if (!candidates.length) return reply(sock, msg, 'Marque ou responda a uma pessoa.')
      const action = ['promover','promote'].includes(used) ? 'promote' : ['rebaixar','demote'].includes(used) ? 'demote' : 'remove'
      try {
        const result = action === 'promote'
          ? await promoteGroupParticipant(sock, msg.key.remoteJid, candidates, { metadata })
          : await updateGroupParticipant(sock, msg.key.remoteJid, candidates, action, { metadata })
        logger?.info?.({ stage: 'group-participant-action', action, target: result.jid, verified: result.verified }, 'ação de participante confirmada pelo WhatsApp')
        if (action === 'promote') {
          await sendPromotedAudio(sock, msg, logger)
          return
        }
        return reply(sock, msg, action === 'demote' ? 'Pessoa rebaixada.' : 'Pessoa removida.', { title: 'GRUPO' })
      } catch (error) {
        logger?.warn?.({ error, stage: 'group-participant-action', action, candidates }, 'ação de participante recusada ou não confirmada')
        const status = error?.status ? ` (status ${error.status})` : ''
        return reply(sock, msg, `Não consegui ${action === 'promote' ? 'promover' : action === 'demote' ? 'rebaixar' : 'remover'} essa pessoa${status}.`, { title: 'GRUPO' })
      }
    }
    return panel({ sock, msg, settings, logger })
  }
})
