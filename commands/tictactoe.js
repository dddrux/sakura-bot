import { defineCommand } from '../data/workstation.js'
import { startTicTacToe, getTicTacToe, moveTicTacToe, cancelTicTacToe, renderBoardPng } from '../data/tictactoe.js'
import { rewardCoins } from '../data/economy.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { firstTargetJid } from '../data/targets.js'

const digits = value => String(value || '').replace(/\D/g, '')
function mentionedNumber(msg) { return digits(firstTargetJid(msg)) }
function mentionJid(number){return `${digits(number)}@s.whatsapp.net`}

async function sendBoard({ sock, msg, game, settings, logger, note = '' }) {
  const image = { buffer: renderBoardPng(game) }
  const current = game.turn ? game.players[game.turn] : ''
  const status = game.winner ? `💮 Vitória de @${game.winner}` : game.draw ? '🌸 Empate' : game.status === 'cancelled' ? '🌸 Partida cancelada' : `🌸 Vez de @${current}`
  const rows = game.status === 'active' ? [{ title: '🌸 Tabuleiro', rows: game.board.map((mark, index) => ({ id: `${settings.prefix}velha jogar ${game.id} ${index + 1}`, title: `${mark ? (mark === 'x' ? '🌸 X' : '🌸 O') : '💮 livre'} • casa ${index + 1}`, description: mark ? 'Casa ocupada' : 'Jogar nesta casa' })).filter((_,index)=>!game.board[index]) }] : [{ title: '🌸 Jogo', rows: [{ id: `${settings.prefix}velha`, title: '🌸 Nova partida', description: 'Marque alguém para jogar' }] }]
  return sendNativeList({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: `tic-tac-toe:${game.id}`, image, body: [status, `🌸 X: @${game.players.x}`, `🌸 O: @${game.players.o}`, note].filter(Boolean).join('\n'), buttonText: '🌸 Escolher casa', mentions: [mentionJid(game.players.x), mentionJid(game.players.o)], sections: rows })
}

export default defineCommand({
  name: 'velha', aliases: ['jogodavelha','ttt','tic-tac-toe'], category: 'Grupo', groupOnly: true,
  usage: '.velha @pessoa', description: 'Jogo da velha rosa por imagem, com botões e Sakura Coins.', menuGroup: 'Jogos',
  slash: { model: '.velha @pessoa', categories: ['jogos','grupo'], copyable: true },
  async execute({ sock, msg, args, senderNumber, settings, logger }) {
    const action=String(args?.[0]||'').toLowerCase()
    if(action==='jogar'){
      const id=String(args[1]||''), cell=Number(args[2])-1
      try{const before=await getTicTacToe(id);const game=await moveTicTacToe(id,senderNumber,cell);if(game.status==='finished'&&before?.status==='active'){if(game.winner)await rewardCoins(game.winner,settings.ticTacToeReward,{reason:'Vitória no jogo da velha',chat:msg.key.remoteJid,type:'game.tictactoe'});else if(game.draw)await Promise.all([game.players.x,game.players.o].map(n=>rewardCoins(n,settings.ticTacToeDrawReward,{reason:'Empate no jogo da velha',chat:msg.key.remoteJid,type:'game.tictactoe.draw'})))}return sendBoard({sock,msg,game,settings,logger})}catch(error){return reply(sock,msg,error.message,{title:'JOGO DA VELHA'})}
    }
    if(action==='ver'){const game=await getTicTacToe(args[1]);if(!game)return reply(sock,msg,'Partida não encontrada.',{title:'JOGO DA VELHA'});return sendBoard({sock,msg,game,settings,logger})}
    if(action==='cancelar'){try{const game=await cancelTicTacToe(args[1],senderNumber);if(!game)return reply(sock,msg,'Partida não encontrada.',{title:'JOGO DA VELHA'});return sendBoard({sock,msg,game,settings,logger,note:'💮 Partida cancelada.'})}catch(error){return reply(sock,msg,error.message,{title:'JOGO DA VELHA'})}}
    const opponent=mentionedNumber(msg)
    if(!opponent||opponent===digits(senderNumber))return reply(sock,msg,`Marque uma pessoa: *${settings.prefix}velha @pessoa*`,{title:'JOGO DA VELHA'})
    const game=await startTicTacToe({chat:msg.key.remoteJid,x:senderNumber,o:opponent})
    return sendBoard({sock,msg,game,settings,logger,note:`🪙 Vitória: ${settings.ticTacToeReward} Sakura Coins.`})
  }
})
