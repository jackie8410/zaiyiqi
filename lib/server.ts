import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export const bindings=()=>env as unknown as Record<string,any>;
export const db=()=>{const v=bindings().DB as D1Database;if(!v)throw new HttpError('数据库暂未连接，请稍后再试',503);return v;};
export const bucket=()=>{const v=bindings().BUCKET as R2Bucket;if(!v)throw new HttpError('照片存储暂未连接',503);return v;};
export class HttpError extends Error {constructor(message:string,public status=400){super(message);}}
export const uid=()=>crypto.randomUUID().replaceAll('-','');
export const now=()=>Date.now();
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function currentUser(required=true){const u=await getChatGPTUser();if(!u){if(required)throw new HttpError('请先登录后继续',401);return null;}await db().prepare('INSERT OR IGNORE INTO users (id,name,credits,pro_until,created) VALUES (?,?,2,0,?)').bind(u.userId,u.fullName||'相册主人',now()).run();const record:any=await db().prepare('SELECT * FROM users WHERE id=?').bind(u.userId).first();return {...u,...record,admin:u.email===bindings().ADMIN_EMAIL,pro:record.pro_until>now()};}
export async function body(request:Request){try{return await request.json() as any;}catch{throw new HttpError('请求格式不正确');}}
export const text=(v:unknown,max=500,fallback='')=>typeof v==='string'?v.trim().slice(0,max):fallback;
export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new HttpError('请求来源校验失败',403);}
export async function owned(table:'photos'|'albums'|'jobs'|'orders',id:string,owner:string){const row:any=await db().prepare(`SELECT * FROM ${table} WHERE id=? AND owner=?`).bind(id,owner).first();if(!row)throw new HttpError('内容不存在或你没有访问权限',404);return row;}
export async function rateLimit(id:string,max=15,seconds=60){const expiry=now()+seconds*1000;await db().prepare('INSERT INTO rate_limits (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END').bind(id,expiry,now(),now()).run();const r:any=await db().prepare('SELECT count FROM rate_limits WHERE id=?').bind(id).first();if(r.count>max)throw new HttpError('操作较频繁，请稍后再试',429);}
export async function hash(v:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function cookie(request:Request,key:string){return(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1);}
export async function readableAlbum(request:Request,token:string){const a:any=await db().prepare('SELECT * FROM albums WHERE share_token=? AND visibility<>?').bind(token,'private').first();if(!a)throw new HttpError('这个相册不存在，或分享已被主人取消',404);if(a.password_hash){const u=await getChatGPTUser();if(u?.userId!==a.owner){const session=cookie(request,`album_${a.id}`)||'';const ok=await db().prepare('SELECT id FROM share_sessions WHERE id=? AND album_id=? AND expires>?').bind(session,a.id,now()).first();if(!ok)throw new HttpError('请输入相册访问密码',423);}}return a;}
export const photoDto=(p:any)=>({id:p.id,name:p.name,mime:p.mime,kind:p.kind,size:p.size,created:p.created,url:`/api/v1/photos/${p.id}`});
export const albumDto=(a:any)=>({id:a.id,title:a.title,subtitle:a.subtitle,theme:a.theme,mode:a.mode,pages:JSON.parse(a.pages),visibility:a.visibility,shareToken:a.share_token,hasPassword:!!a.password_hash,revision:a.revision,updated:a.updated});
export const jobDto=(j:any)=>({...j,config:JSON.parse(j.config),sources:JSON.parse(j.sources),results:JSON.parse(j.results)});
