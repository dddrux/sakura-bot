import { settings } from './settings.js'
export class TTLCache {
  constructor({ ttlMs = 60000, max = 500 } = {}) { this.ttlMs=Math.max(1000,Number(ttlMs)||60000); this.max=Math.max(10,Number(max)||500); this.map=new Map(); this.inflight=new Map(); this.hits=0; this.misses=0 }
  get(key){const id=String(key), row=this.map.get(id); if(!row){this.misses++;return undefined} if(row.expiresAt<=Date.now()){this.map.delete(id);this.misses++;return undefined} this.hits++;return row.value}
  set(key,value,ttlMs=this.ttlMs){const id=String(key);this.map.delete(id);this.map.set(id,{value,expiresAt:Date.now()+Math.max(1000,Number(ttlMs)||this.ttlMs)});while(this.map.size>this.max)this.map.delete(this.map.keys().next().value);return value}
  delete(key){return this.map.delete(String(key))} clear(){this.map.clear();this.inflight.clear()}
  async remember(key,producer,ttlMs=this.ttlMs){const cached=this.get(key);if(cached!==undefined)return cached;const id=String(key);if(this.inflight.has(id))return this.inflight.get(id);const pending=Promise.resolve().then(producer).then(v=>this.set(id,v,ttlMs)).finally(()=>this.inflight.delete(id));this.inflight.set(id,pending);return pending}
  snapshot(){return{size:this.map.size,inflight:this.inflight.size,hits:this.hits,misses:this.misses,ttlMs:this.ttlMs,max:this.max}}
}
export const profilePictureCache=new TTLCache({ttlMs:settings.profilePictureTtlMs||600000,max:1000})
export const groupMetadataCache=new TTLCache({ttlMs:settings.groupMetadataTtlMs||120000,max:500})
export const mediaResultCache=new TTLCache({ttlMs:settings.mediaResultTtlMs||900000,max:300})
export const aiResponseCache=new TTLCache({ttlMs:settings.aiResponseTtlMs||120000,max:500})
export async function cachedProfilePicture(sock,jid,type='image'){if(!sock?.profilePictureUrl||!jid)return '';return profilePictureCache.remember(`${jid}:${type}`,async()=>{try{return await sock.profilePictureUrl(jid,type)||''}catch{return ''}})}
