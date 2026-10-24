import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings, readConfig, writeConfigSync } from './settings.js'
import { getTriggersDatabase, updateTriggersDatabase } from './triggers.js'
import { applyUpdatePackage } from './update-manager.js'
import { runtimeSettings, updateRuntimeSettings } from './runtime.js'
import { LoginRateLimiter, panelSecurityHeaders, removeInitialPanelPassword, writeInitialPanelPassword } from './panel-security.js'

const panelStore = openDatabase(settings.panelDb, { version: 1, passwordHash: '', salt: '', updateSecret: '', createdAt: '' })
const sessions = new Map()
const loginLimiter = new LoginRateLimiter()
const MAX_BODY = 50 * 1024 * 1024
const PANEL_SESSION_TTL_MS = 12 * 60 * 60_000
const INITIAL_PASSWORD_FILE = path.join(settings.configDir, 'private', 'panel-initial-password.txt')

function hashPassword(password, salt) { return scryptSync(String(password), salt, 32).toString('hex') }
function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'hex'); const right = Buffer.from(String(b), 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}
function json(res, status, data) { res.writeHead(status, panelSecurityHeaders('application/json; charset=utf-8')); res.end(JSON.stringify(data)) }
function text(res, status, body, type='text/plain; charset=utf-8') { res.writeHead(status, panelSecurityHeaders(type)); res.end(body) }
function tokenFrom(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') }
function pruneSessions(now = Date.now()) {
  for (const [token, expiry] of sessions) if (expiry < now) sessions.delete(token)
  while (sessions.size > 100) sessions.delete(sessions.keys().next().value)
}
function isAuthorized(req) { pruneSessions(); const token = tokenFrom(req); const expiry = sessions.get(token); if (!expiry || expiry < Date.now()) { sessions.delete(token); return false } return true }
function clientKey(req) { return String(req.socket?.remoteAddress || 'unknown').slice(0, 200) }
async function readBody(req, limit = MAX_BODY) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Arquivo muito grande'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function readJson(req) { const body = await readBody(req, 2 * 1024 * 1024); return body.length ? JSON.parse(body.toString('utf8')) : {} }
function sanitizeFileName(name, extensions) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100)
  if (!extensions.some(ext => base.toLowerCase().endsWith(ext))) throw new Error('Extensão não permitida')
  return base
}
async function writeConfig(next) { return writeConfigSync(next) }


async function ensurePanelCredentials(logger) {
  let temporaryPassword = ''
  const data = await panelStore.read()
  if (!data.salt || !data.passwordHash || !data.updateSecret) {
    temporaryPassword = randomBytes(12).toString('base64url')
    await panelStore.update(db => {
      db.salt = randomBytes(16).toString('hex')
      db.passwordHash = hashPassword(temporaryPassword, db.salt)
      db.updateSecret = randomBytes(32).toString('hex')
      db.createdAt = new Date().toISOString()
    })
    const credentialFile = await writeInitialPanelPassword(INITIAL_PASSWORD_FILE, temporaryPassword)
    logger?.warn?.({ file: credentialFile }, 'senha inicial do painel criada em arquivo privado; altere após entrar')
  }
  return temporaryPassword
}

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sakura Panel</title><style>
:root{--bg:#031226;--card:#071e3d;--ice:#57b9ff;--ice2:#b8e8ff;--text:#edf9ff;--muted:#9bc9e8;--line:#1b5f9d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#0b3e72 0,#061b35 40%,#020b18 100%);color:var(--text);font:15px system-ui,sans-serif}.wrap{max-width:1100px;margin:auto;padding:24px}.logo{font:700 30px monospace;color:var(--ice2);white-space:pre;overflow:auto;text-shadow:0 0 18px #52b8ff}.card{background:rgba(7,30,61,.96);border:1px solid var(--line);border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 10px 30px #0008}h1,h2{margin:0 0 14px;color:var(--ice2)}input,select,textarea,button{width:100%;padding:11px;margin:5px 0;border-radius:10px;border:1px solid var(--line);background:#03152b;color:var(--text)}button{background:linear-gradient(135deg,#66c7ff,#2e83df);color:#021326;font-weight:800;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #174b78}.row button{width:auto}.hide{display:none}.small{color:var(--muted);font-size:13px}.ok{color:#7fffd4}.err{color:#ff9eae}</style></head><body><div class="wrap"><div class="logo">  💮 SAKURA PANEL\n  SAKURA-MD • ICE</div>
<div id="login" class="card"><h2>💮 Acesso do dono</h2><input id="number" placeholder="Owner number"><input id="password" type="password" placeholder="Senha"><button onclick="login()">Entrar</button><p id="loginMsg"></p></div>
<div id="app" class="hide"><div class="card"><h2>💮 Main configuration</h2><div class="grid"><input id="botName" placeholder="Bot name"><input id="botNumber" placeholder="Bot number"><input id="ownerNumber" placeholder="Owner number"><input id="prefix" placeholder="Prefix"></div><button onclick="saveConfig()">Save configuration</button><p class="small">Name, number and prefix changes are applied after restarting the bot.</p></div>
<div class="card"><h2>🌸 Opções</h2><div class="grid"><label><input id="autoReplyAudio" type="checkbox"> Áudios automáticos</label><label><input id="autoReplySticker" type="checkbox"> Figurinhas automáticas</label><label><input id="stickerMetadata" type="checkbox"> Metadados Sakura</label></div><button onclick="saveRuntime()">Salvar opções</button></div>
<div class="card"><h2>💮 Áudios e triggers</h2><div class="grid"><input id="audioId" placeholder="ID"><input id="audioPhrases" placeholder="frase 1 | frase 2"><input id="audioFile" type="file" accept="audio/*"></div><button onclick="uploadMedia('audio')">Enviar áudio e salvar trigger</button><div id="audioRows"></div></div>
<div class="card"><h2>🌸 Figurinhas e triggers</h2><div class="grid"><input id="stickerId" placeholder="ID"><input id="stickerPhrases" placeholder="frase 1 | frase 2"><input id="stickerFile" type="file" accept="image/webp"></div><button onclick="uploadMedia('sticker')">Enviar figurinha e salvar trigger</button><div id="stickerRows"></div></div>
<div class="card"><h2>🌸 Atualização Sakura</h2><input id="updateFile" type="file" accept=".sakura-update"><button onclick="applyUpdate()">Validar e aplicar atualização</button><p class="small">Formato assinado. Sessão, bancos, configuração e logs são protegidos.</p></div>
<div class="card"><h2>🌸 Senha</h2><input id="newPassword" type="password" placeholder="Nova senha"><button onclick="changePassword()">Alterar senha</button></div><p id="msg"></p></div></div><script>
let token=sessionStorage.sakuraToken||'';const $=id=>document.getElementById(id);async function api(url,opt={}){opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token};const r=await fetch(url,opt);const j=await r.json().catch(()=>({error:'Resposta inválida'}));if(!r.ok)throw Error(j.error||'Erro');return j}function flash(t,e=false){$('msg').className=e?'err':'ok';$('msg').textContent=t}
async function login(){try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({numero:$('number').value,senha:$('password').value})});const j=await r.json();if(!r.ok)throw Error(j.error);token=j.token;sessionStorage.sakuraToken=token;await load()}catch(e){$('loginMsg').textContent=e.message}}
async function load(){try{const s=await api('/api/state');$('login').classList.add('hide');$('app').classList.remove('hide');for(const k of ['botName','botNumber','ownerNumber','prefix'])$(k).value=s.config[k]||'';for(const k of ['autoReplyAudio','autoReplySticker','stickerMetadata'])$(k).checked=!!s.runtime[k];render('audio',s.triggers.audio);render('sticker',s.triggers.stickers)}catch{$('login').classList.remove('hide');$('app').classList.add('hide')}}
function render(type,data){const box=$(type+'Rows');box.innerHTML='';for(const [id,e] of Object.entries(data||{})){const d=document.createElement('div');d.className='row';const active=e.enabled!==false;d.innerHTML='<b>'+(active?'🌸 ':'💮 ')+id+'</b><span>'+(e.phrases||[]).join(' | ')+'</span><button>'+(active?'Desativar':'Ativar')+'</button>';d.querySelector('button').onclick=()=>toggleTrigger(type,id,!active);box.appendChild(d)}}
async function saveConfig(){try{await api('/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({botName:$('botName').value,botNumber:$('botNumber').value,ownerNumber:$('ownerNumber').value,prefix:$('prefix').value})});flash('Configuration saved. Restart the bot.')}catch(e){flash(e.message,true)}}
async function saveRuntime(){try{await api('/api/runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({autoReplyAudio:$('autoReplyAudio').checked,autoReplySticker:$('autoReplySticker').checked,stickerMetadata:$('stickerMetadata').checked})});flash('Opções salvas')}catch(e){flash(e.message,true)}}
async function uploadMedia(type){try{const file=$(type+'File').files[0];if(!file)throw Error('Escolha um arquivo');const id=$(type+'Id').value.trim()||file.name.replace(/\.[^.]+$/,'');const phrases=$(type+'Phrases').value.split('|').map(x=>x.trim()).filter(Boolean);if(!phrases.length)throw Error('Informe ao menos uma frase');const up=await api('/api/upload/'+type+'?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});await api('/api/trigger/'+type,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,file:up.file,phrases,enabled:true,ptt:true})});flash('Salvo');await load()}catch(e){flash(e.message,true)}}
async function toggleTrigger(type,id,enabled){try{await api('/api/trigger/toggle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id,enabled})});await load()}catch(e){flash(e.message,true)}}
async function applyUpdate(){try{const file=$('updateFile').files[0];if(!file)throw Error('Escolha uma atualização');const r=await api('/api/update?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});flash('Atualização '+r.version+' aplicada. Reinicie o bot.')}catch(e){flash(e.message,true)}}
async function changePassword(){try{await api('/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({senha:$('newPassword').value})});flash('Senha alterada')}catch(e){flash(e.message,true)}}
if(token)load();</script></body></html>`

export async function startPanel(logger) {
  await ensurePanelCredentials(logger)
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      if (req.method === 'GET' && url.pathname === '/') return text(res, 200, PAGE, 'text/html; charset=utf-8')
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const client = clientKey(req)
        const loginStatus = loginLimiter.status(client)
        if (!loginStatus.allowed) return json(res, 429, { error: 'Muitas tentativas. Tente novamente mais tarde.', retryAfterSeconds: Math.ceil(loginStatus.remainingMs / 1000) })
        const body = await readJson(req); const panel = await panelStore.read()
        const number = String(body.numero || '').replace(/\D/g, '')
        const valid = number === settings.ownerNumber && safeEqual(hashPassword(body.senha || '', panel.salt), panel.passwordHash)
        if (!valid) {
          const failed = loginLimiter.failure(client)
          return json(res, failed.allowed ? 403 : 429, { error: failed.allowed ? 'Acesso negado' : 'Muitas tentativas. Tente novamente mais tarde.', retryAfterSeconds: failed.remainingMs ? Math.ceil(failed.remainingMs / 1000) : undefined })
        }
        loginLimiter.success(client)
        pruneSessions()
        const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + PANEL_SESSION_TTL_MS)
        return json(res, 200, { token })
      }
      if (!url.pathname.startsWith('/api/') || !isAuthorized(req)) return json(res, 401, { error: 'Não autorizado' })
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { config: readConfig(), runtime: runtimeSettings(), triggers: await getTriggersDatabase() })
      if (req.method === 'POST' && url.pathname === '/api/runtime') return json(res, 200, { runtime: await updateRuntimeSettings(await readJson(req)) })
      if (req.method === 'POST' && url.pathname === '/api/config') return json(res, 200, { config: await writeConfig(await readJson(req)), restartRequired: true })
      if (req.method === 'POST' && url.pathname === '/api/password') {
        const body = await readJson(req); if (String(body.senha || '').length < 8) throw new Error('Use ao menos 8 caracteres')
        await panelStore.update(db => { db.salt = randomBytes(16).toString('hex'); db.passwordHash = hashPassword(body.senha, db.salt) })
        await removeInitialPanelPassword(INITIAL_PASSWORD_FILE)
        sessions.clear()
        return json(res, 200, { ok: true, loginAgain: true })
      }
      if (req.method === 'POST' && ['/api/trigger/audio','/api/trigger/sticker'].includes(url.pathname)) {
        const type = url.pathname.endsWith('audio') ? 'audio' : 'stickers'; const body = await readJson(req); const id = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
        if (!id || !body.file || !Array.isArray(body.phrases) || !body.phrases.length) throw new Error('Trigger inválido')
        await updateTriggersDatabase(db => { db[type][id] = { file: String(body.file), phrases: body.phrases.map(String).filter(Boolean), enabled: body.enabled !== false, ...(type === 'audio' ? { ptt: body.ptt !== false } : {}) } })
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/trigger/toggle') {
        const body = await readJson(req); const type = body.type === 'audio' ? 'audio' : 'stickers'; const id = String(body.id || '')
        await updateTriggersDatabase(db => { if (db?.[type]?.[id]) db[type][id].enabled = body.enabled !== false })
        return json(res, 200, { ok: true })
      }
      if (req.method === 'DELETE' && url.pathname === '/api/trigger') {
        const type = url.searchParams.get('type') === 'audio' ? 'audio' : 'stickers'; const id = url.searchParams.get('id')
        await updateTriggersDatabase(db => { if (db?.[type]?.[id]) db[type][id].enabled = false })
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && ['/api/upload/audio','/api/upload/sticker'].includes(url.pathname)) {
        const isAudio = url.pathname.endsWith('audio'); const extensions = isAudio ? ['.mp3','.ogg','.opus','.m4a','.wav'] : ['.webp']; const fileName = sanitizeFileName(url.searchParams.get('filename'), extensions)
        const buffer = await readBody(req); if (!buffer.length) throw new Error('Arquivo vazio')
        const directory = isAudio ? path.join(settings.audioDir, 'custom') : path.join(settings.stickerDir, 'custom'); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, fileName), buffer)
        return json(res, 200, { file: `custom/${fileName}` })
      }
      if (req.method === 'POST' && url.pathname === '/api/update') {
        const fileName = sanitizeFileName(url.searchParams.get('filename'), ['.sakura-update']); const buffer = await readBody(req); const file = path.join(settings.updatesDir, `${Date.now()}-${fileName}`); await fs.mkdir(settings.updatesDir, { recursive: true }); await fs.writeFile(file, buffer)
        const panel = await panelStore.read(); const result = await applyUpdatePackage(file, panel.updateSecret, logger); return json(res, 200, result)
      }
      return json(res, 404, { error: 'Rota não encontrada' })
    } catch (error) { logger?.error?.({ error }, 'erro no painel'); return json(res, 400, { error: error.message || 'Erro' }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(settings.panelPort, settings.panelHost, resolve) })
  logger?.success?.({ url: `http://${settings.panelHost}:${settings.panelPort}` }, 'painel Sakura iniciado')
  return server
}
