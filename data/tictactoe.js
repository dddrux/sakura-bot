import zlib from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase('games', { version: 1, ticTacToe: {} })
const digits = value => String(value || '').replace(/\D/g, '')
const clone = value => structuredClone(value)

function stateWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]
  return ''
}

export function createGame({ chat, x, o } = {}) {
  const px = digits(x), po = digits(o)
  if (!chat || !px || !po || px === po) throw new TypeError('Jogadores inválidos.')
  return { id: randomUUID().slice(0, 8), chat: String(chat), players: { x: px, o: po }, board: Array(9).fill(''), turn: 'x', winner: '', draw: false, status: 'active', createdAt: Date.now(), updatedAt: Date.now() }
}

export function playMove(game, number, cell) {
  if (!game || game.status !== 'active') throw new Error('Partida encerrada.')
  const player = digits(number), index = Number(cell)
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error('Casa inválida.')
  const mark = game.players.x === player ? 'x' : game.players.o === player ? 'o' : ''
  if (!mark) throw new Error('Você não participa desta partida.')
  if (mark !== game.turn) throw new Error('Ainda não é sua vez.')
  if (game.board[index]) throw new Error('Essa casa já está ocupada.')
  const next = clone(game); next.board[index] = mark; next.updatedAt = Date.now()
  const winnerMark = stateWinner(next.board)
  if (winnerMark) { next.winner = next.players[winnerMark]; next.status = 'finished'; next.turn = '' }
  else if (next.board.every(Boolean)) { next.draw = true; next.status = 'finished'; next.turn = '' }
  else next.turn = mark === 'x' ? 'o' : 'x'
  return next
}

export async function startTicTacToe(args) {
  const game = createGame(args)
  return store.update(db => { db.ticTacToe[game.id] = game; return clone(game) })
}
export async function getTicTacToe(id) { const db = await store.read(); return clone(db.ticTacToe?.[String(id)] || null) }
export async function moveTicTacToe(id, number, cell) {
  return store.update(db => { const current = db.ticTacToe?.[String(id)]; if (!current) throw new Error('Partida não encontrada.'); const next = playMove(current, number, cell); db.ticTacToe[id] = next; return clone(next) })
}
export async function cancelTicTacToe(id, number) {
  return store.update(db => { const game=db.ticTacToe?.[String(id)]; if(!game)return null; const n=digits(number); if(!Object.values(game.players).includes(n))throw new Error('Você não participa desta partida.'); game.status='cancelled';game.turn='';game.updatedAt=Date.now();return clone(game) })
}
export async function cleanupTicTacToe(maxAgeMs = settings.ticTacToeTimeoutMs) { return store.update(db=>{let removed=0;const now=Date.now();for(const [id,g] of Object.entries(db.ticTacToe||{})){if(g.status!=='active'||now-Number(g.updatedAt||g.createdAt||0)>maxAgeMs){delete db.ticTacToe[id];removed++}}return removed}) }

function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc])}
function setPixel(raw,w,x,y,r,g,b){if(x<0||y<0||x>=w||y>=w)return;const row=y*(1+w*3)+1+x*3;raw[row]=r;raw[row+1]=g;raw[row+2]=b}
function line(raw,w,x0,y0,x1,y1,color,thick=4){const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;while(true){for(let ox=-thick;ox<=thick;ox++)for(let oy=-thick;oy<=thick;oy++)setPixel(raw,w,x0+ox,y0+oy,...color);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx}if(e2<=dx){err+=dx;y0+=sy}}}
function circle(raw,w,cx,cy,r,color,thick=5){for(let a=0;a<360;a+=0.7){const rad=a*Math.PI/180;const x=Math.round(cx+Math.cos(rad)*r),y=Math.round(cy+Math.sin(rad)*r);for(let t=-thick;t<=thick;t++)setPixel(raw,w,x+t,y,...color)}}
export function renderBoardPng(game,{size=512}={}){
  const w=Math.max(192,Math.min(768,Number(size)||512));const raw=Buffer.alloc((w*3+1)*w);const bg=[255,226,240],grid=[206,92,151],xcol=[172,53,122],ocol=[238,118,177]
  for(let y=0;y<w;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++)setPixel(raw,w,x,y,...bg)}
  const s=w/3;for(const p of [s,2*s]){line(raw,w,Math.round(p),24,Math.round(p),w-24,grid,2);line(raw,w,24,Math.round(p),w-24,Math.round(p),grid,2)}
  for(let i=0;i<9;i++){const mark=game?.board?.[i];if(!mark)continue;const cx=(i%3+0.5)*s,cy=(Math.floor(i/3)+0.5)*s,r=s*0.25;if(mark==='x'){line(raw,w,Math.round(cx-r),Math.round(cy-r),Math.round(cx+r),Math.round(cy+r),xcol,5);line(raw,w,Math.round(cx+r),Math.round(cy-r),Math.round(cx-r),Math.round(cy+r),xcol,5)}else circle(raw,w,cx,cy,r,ocol,5)}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(w,4);ihdr[8]=8;ihdr[9]=2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:8})),chunk('IEND',Buffer.alloc(0))])
}
