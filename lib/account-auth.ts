import {bindings,db,HttpError,now,uid,hash,cookie,rateLimit,text} from './server';
import {emailReady,sendVerificationEmail} from './email';

export type AccountStatus='pending'|'approved'|'rejected'|'suspended';
export const SESSION_COOKIE='zaiyiqi_session';
const SESSION_AGE=7*86400;
const CODE_AGE=10*60*1000;
export function normalizeEmail(value:unknown){
 const email=typeof value==='string'?value.trim().toLowerCase():'';
 if(email.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email))throw new HttpError('请输入有效的邮箱地址');
 return email;
}
export const ownerEmail=()=>String(bindings().ADMIN_EMAIL||'').trim().toLowerCase();
function accountDto(row:any){return {...row,userId:row.id,fullName:row.name,displayName:row.name,admin:!!ownerEmail()&&row.email===ownerEmail(),pro:row.pro_until>now()};}
export const publicAccount=(u:any)=>u?({id:u.id,email:u.email,name:u.name,status:u.status,admin:u.admin,reviewNote:u.review_note||'',credits:u.credits,pro:u.pro,proUntil:u.pro_until}):null;
async function accountByUser(id:string){const row=await db().prepare('SELECT u.*,a.email,a.status,a.review_note FROM users u JOIN email_accounts a ON a.user_id=u.id WHERE u.id=?').bind(id).first();return row?accountDto(row):null;}

// Email sessions take precedence, including limited pending/rejected sessions.
export async function resolveAccount(request?:Request):Promise<any>{
 const token=request?cookie(request,SESSION_COOKIE):undefined;
 if(token){
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const session:any=await db().prepare('SELECT user_id FROM account_sessions WHERE token_hash=? AND expires>?').bind(await hash(token),now()).first();
  return session?accountByUser(session.user_id):null;
 }
 return null;
}
async function codeHash(id:string,code:string){
 const secret=String(bindings().AUTH_SECRET||'');
 if(secret.length<32)throw new HttpError('邮箱登录正在配置，请稍后再试',503);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+':'+code));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function randomCode(){const values=new Uint32Array(1);do{crypto.getRandomValues(values);}while(values[0]>=4294000000);return String(values[0]%1000000).padStart(6,'0');}

export async function requestEmailCode(request:Request,input:any){
 if(!emailReady()||String(bindings().AUTH_SECRET||'').length<32)throw new HttpError('邮箱验证服务尚未开通，请联系网站管理员',503);
 const email=normalizeEmail(input.email),purpose=input.purpose==='register'?'register':'login';
 const name=text(input.name,30),application=text(input.application,300);
 if(purpose==='register'&&(!name||!application))throw new HttpError('请填写昵称和申请说明');
 const ip=request.headers.get('cf-connecting-ip')||'local';
 await rateLimit('auth-ip:'+await hash(ip),20,3600);
 await rateLimit('auth-email-minute:'+await hash(email),1,60);
 await rateLimit('auth-email-hour:'+await hash(email),5,3600);
 await rateLimit('auth-global-day',Number(bindings().AUTH_MAIL_DAILY_LIMIT)||200,86400);
 const id=uid(),code=randomCode(),created=now();
 const digest=await codeHash(id,code);
 await db().prepare('DELETE FROM email_codes WHERE expires<?').bind(created-86400000).run();
 await db().prepare('DELETE FROM account_sessions WHERE expires<?').bind(created).run();
 await db().prepare('INSERT INTO email_codes(id,email,code_hash,purpose,name,application,expires,created) VALUES(?,?,?,?,?,?,?,?)').bind(id,email,digest,purpose,name,application,created+CODE_AGE,created).run();
 try{await sendVerificationEmail(email,code,id,purpose,created);}catch{
  await db().prepare('DELETE FROM email_codes WHERE id=?').bind(id).run();
  throw new HttpError('验证码邮件暂未发送成功，请稍后重试或联系管理员',502);
 }
 return {challengeId:id,expiresIn:CODE_AGE/1000,resendAfter:60,sentAt:created};
}
export async function verifyEmailCode(input:any){
 const id=text(input.challengeId,64),code=text(input.code,6);
 if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError('请输入邮件中的6位验证码');
 // Increment in SQL so concurrent guesses cannot bypass the attempt limit.
 const row:any=await db().prepare('UPDATE email_codes SET attempts=attempts+1 WHERE id=? AND consumed IS NULL AND expires>? AND attempts<5 RETURNING *').bind(id,now()).first();
 if(!row||row.code_hash!==await codeHash(id,code))throw new HttpError('验证码无效、已使用或已过期，请重新获取',400);
 const claimed:any=await db().prepare('UPDATE email_codes SET consumed=? WHERE id=? AND consumed IS NULL RETURNING id').bind(now(),id).first();
 if(!claimed)throw new HttpError('验证码已使用，请重新获取');
 let found:any=await db().prepare('SELECT user_id FROM email_accounts WHERE email=?').bind(row.email).first();
 if(!found){
  if(row.purpose!=='register')throw new HttpError('此邮箱尚未申请账号，请先选择邮箱注册',404);
  const userId=uid(),stamp=now(),isOwner=!!ownerEmail()&&row.email===ownerEmail();
  try{await db().batch([
   db().prepare('INSERT INTO users(id,name,credits,pro_until,created) VALUES(?,?,2,0,?)').bind(userId,row.name,stamp),
   db().prepare('INSERT INTO email_accounts(user_id,email,status,application,verified_at,reviewed_at,created) VALUES(?,?,?,?,?,?,?)').bind(userId,row.email,isOwner?'approved':'pending',row.application,stamp,isOwner?stamp:null,stamp)
  ]);found={user_id:userId};}catch(error){
   found=await db().prepare('SELECT user_id FROM email_accounts WHERE email=?').bind(row.email).first();
   if(!found)throw error;
  }
 }
 const user=await accountByUser(found.user_id),token=uid()+uid();
 await db().prepare('INSERT INTO account_sessions(token_hash,user_id,expires,created) VALUES(?,?,?,?)').bind(await hash(token),user.id,now()+SESSION_AGE*1000,now()).run();
 return {user,token};
}
export function sessionCookie(token:string,request:Request,clear=false){return `${SESSION_COOKIE}=${clear?'':token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:SESSION_AGE}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function logoutAccount(request:Request){const token=cookie(request,SESSION_COOKIE);if(token)await db().prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await hash(token)).run();}
export async function reviewAccounts(actor:any,input:any){
 if(!actor?.admin||actor.status!=='approved')throw new HttpError('没有审核权限',403);
 const targetId=text(input.userId,100),status=text(input.status,20),note=text(input.note,300);
 if(!['approved','rejected','suspended'].includes(status))throw new HttpError('审核状态不正确');
 if(targetId===actor.id)throw new HttpError('不能修改自己的开通状态');
 const target=await accountByUser(targetId);if(!target)throw new HttpError('申请不存在',404);
 if(target.admin)throw new HttpError('不能修改网站所有者账号',403);
 const changed=await db().batch([
  db().prepare('UPDATE email_accounts SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE user_id=? AND status=?').bind(status,note,actor.id,now(),targetId,target.status),
  db().prepare('INSERT INTO account_reviews(id,user_id,actor_id,previous_status,status,note,created) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(uid(),targetId,actor.id,target.status,status,note,now())
 ]);
 if(!changed[0].meta.changes)throw new HttpError('账号状态刚刚发生变化，请刷新后重试',409);
 if(status==='suspended')await db().prepare('DELETE FROM account_sessions WHERE user_id=?').bind(targetId).run();
 return {ok:true};
}
