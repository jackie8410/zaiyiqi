// Exercises the actual auth and album route handlers against SQLite and in-memory R2.
// Only platform identity bindings and the email transport are replaced. No network calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
const database=new DatabaseSync(':memory:');
database.exec(await readFile('drizzle/0000_mysterious_kid_colt.sql','utf8'));
database.prepare('INSERT INTO users(id,name,credits,pro_until,created) VALUES(?,?,?,?,?)').run('legacy-owner','原账号',17,Date.now()+86400000,1);
database.prepare('INSERT INTO photos(id,owner,object_key,name,mime,size,kind,created) VALUES(?,?,?,?,?,?,?,?)').run('original-photo','legacy-owner','old/photo','原照片','image/jpeg',12,'original',1);
database.prepare('INSERT INTO albums(id,owner,title,theme,mode,pages,created,updated) VALUES(?,?,?,?,?,?,?,?)').run('original-album','legacy-owner','原相册','linen','book','[{"photoId":"original-photo","caption":"原页序"}]',1,1);
const original=JSON.stringify(['users','photos','albums'].map(t=>database.prepare('SELECT * FROM '+t).all()));
database.exec(await readFile('drizzle/0001_email_accounts.sql','utf8'));
let checks=0;const ok=(v,message)=>{assert.ok(v,message);checks++;};
ok(original===JSON.stringify(['users','photos','albums'].map(t=>database.prepare('SELECT * FROM '+t).all())),'additive migration preserves all existing rows and credits');
const adapter={prepare(sql){return {values:[],bind(...args){this.values=args;return this;},async first(){return database.prepare(sql).get(...this.values)||null;},async all(){return {results:database.prepare(sql).all(...this.values)};},async run(){const r=database.prepare(sql).run(...this.values);return {success:true,meta:{changes:r.changes}};}};},async batch(list){database.exec('BEGIN');try{const results=[];for(const s of list)results.push(await s.run());database.exec('COMMIT');return results;}catch(e){database.exec('ROLLBACK');throw e;}}};
const objects=new Map([['old/photo',new Uint8Array(12)]]);
const bucket={async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async get(key){const b=objects.get(key);return b?{body:b,size:b.length}:null;},async delete(key){objects.delete(key);}};
const env={DB:adapter,BUCKET:bucket,ADMIN_EMAIL:'owner@example.test',AUTH_SECRET:randomBytes(32).toString('hex'),RESEND_API_KEY:'test-secret-not-real',AUTH_EMAIL_FROM:'在一起 <test@example.test>',PAYMENT_SALES_ENABLED:'false',FRONTEND_URL:'https://album.learnforeverything.com'};
let currentHeaders=new Headers(),mailFails=false;const mail=[];
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const data=JSON.parse(options.body);if(mailFails)return Response.json({error:'simulated outage'},{status:503});mail.push(data);return Response.json({id:crypto.randomUUID()});};
globalThis.__authTest={env,headers:()=>currentHeaders};
const built=await build({stdin:{contents:"export * as auth from './app/api/auth/[...path]/route.ts'; export * as album from './app/api/v1/[...path]/route.ts';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',target:'es2022',logLevel:'silent',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},args=>({path:args.path,namespace:'test-platform'}));b.onLoad({filter:/.*/,namespace:'test-platform'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__authTest.env;':'export async function headers(){return globalThis.__authTest.headers();}'}));}}]});
const {auth,album}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const base='https://album.example.test';
const legacy={'oai-authenticated-user-id':'legacy-owner','oai-authenticated-user-email':'owner@example.test'};
function cookies(response){return response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
async function request(group,path,method='GET',body,session='',extra={}){
 const headers={...extra};if(session)headers.Cookie=session;if(method!=='GET'&&!headers.Origin)headers.Origin=base;if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const req=new Request(base+'/api/'+group+'/'+path,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});currentHeaders=req.headers;
 return (group==='auth'?auth:album)[method](req,{params:Promise.resolve({path:path.split('?')[0].split('/')})});
}
async function expect(group,path,status,method='GET',body,session='',extra={}){const r=await request(group,path,method,body,session,extra);assert.equal(r.status,status,`${group}/${path}: ${await r.clone().text()}`);checks++;return r;}
function freshLimits(){database.exec('DELETE FROM rate_limits');}
async function send(email,purpose='register'){freshLimits();const r=await expect('auth','request-code',200,'POST',{email,purpose,name:'测试用户',application:'使用虚构人物体验相册'});const result=await r.json();ok(!JSON.stringify(result).includes(mail.at(-1).text.match(/验证码：(\d{6})/)[1]),'never returns OTP in response');return {...result,code:mail.at(-1).text.match(/验证码：(\d{6})/)[1]};}
try{
 await expect('auth','legacy-link',404,'POST',{},'',legacy);
 ok((await(await expect('auth','status',200,'GET',undefined,'',legacy)).json()).account===null,'platform identity alone never logs in');
 const ownerChallenge=await send('owner@example.test');
 const ownerResponse=await expect('auth','verify',200,'POST',ownerChallenge);const owner=cookies(ownerResponse),ownerAccount=(await ownerResponse.json()).account;
 ok(ownerAccount.admin&&ownerAccount.status==='approved','verified configured owner receives review access');
 ok(database.prepare("SELECT credits FROM users WHERE id='legacy-owner'").get().credits===17,'removing legacy linking leaves old credits untouched');
 const oldState=await(await expect('v1','state',200,'GET',undefined,owner)).json();ok(oldState.photos.length===0&&oldState.albums.length===0,'new owner email account cannot silently claim old data');
 const frontend=env.FRONTEND_URL;
 const preflight=await expect('auth','verify',204,'OPTIONS',undefined,'',{Origin:frontend,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'});
 ok(preflight.headers.get('Access-Control-Allow-Origin')===frontend&&preflight.headers.get('Access-Control-Allow-Credentials')==='true','Pages preflight allows exact frontend and credentials');
 await expect('auth','status',403,'GET',undefined,'',{Origin:frontend+'.attacker.test'});
 await expect('auth','verify',403,'OPTIONS',undefined,'',{Origin:'null','Access-Control-Request-Method':'POST'});
 await expect('auth','verify',403,'OPTIONS',undefined,'',{Origin:'https://other.learnforeverything.com','Access-Control-Request-Method':'POST'});
 await expect('v1','profile',405,'OPTIONS',undefined,'',{Origin:frontend,'Access-Control-Request-Method':'TRACE'});
 const crossState=await expect('auth','status',200,'GET',undefined,owner,{Origin:frontend});
 ok((await crossState.json()).account.id===ownerAccount.id&&crossState.headers.get('Vary').includes('Origin'),'email session works from Pages frontend');
 const crossVerifyChallenge=await send('owner@example.test','login');
 const crossVerify=await expect('auth','verify',200,'POST',crossVerifyChallenge,'',{Origin:frontend});
 ok(crossVerify.headers.getSetCookie().length===1&&crossVerify.headers.getSetCookie()[0].includes('HttpOnly'),'CORS retains the secure session cookie');
 await expect('v1','profile',200,'PATCH',{name:'网站所有者'},owner,{Origin:frontend});
 await expect('auth','request-code',403,'POST',{email:'visitor@example.test'},'',{Origin:'https://attacker.example.test'});
 await expect('auth','request-code',400,'POST',{email:'bad\r\nBcc:victim@example.test',purpose:'register',name:'test',application:'test'});
 const challenge=await send('NEW@example.test');
 ok(database.prepare('SELECT code_hash FROM email_codes WHERE id=?').get(challenge.challengeId).code_hash!==challenge.code,'OTP stored only as keyed hash');
 await expect('auth','verify',400,'POST',{...challenge,code:'nope'});
 const verified=await expect('auth','verify',200,'POST',challenge);const member=cookies(verified),newAccount=(await verified.json()).account;
 ok(newAccount.email==='new@example.test'&&newAccount.status==='pending','verified registration requires owner review');
 ok(verified.headers.getSetCookie()[0].includes('HttpOnly')&&verified.headers.getSetCookie()[0].includes('Secure')&&verified.headers.getSetCookie()[0].includes('SameSite=Lax'),'protected secure cookie');
 await expect('auth','verify',400,'POST',challenge);
 await expect('v1','photos',403,'POST',{},member);
 await expect('auth','admin/accounts',403,'GET',undefined,member);
 ok((await(await expect('v1','state',200,'GET',undefined,member)).json()).user===null,'pending users cannot read private studio state');
 const reviewList=await(await expect('auth','admin/accounts',200,'GET',undefined,owner)).json();ok(reviewList.accounts.some(a=>a.id===newAccount.id),'owner sees actual pending request');
 await expect('auth','admin/accounts',200,'POST',{userId:newAccount.id,status:'approved',note:'测试审核'},owner);
 const approved=await(await expect('v1','state',200,'GET',undefined,member)).json();ok(approved.user.id===newAccount.id&&approved.user.credits===2,'approval takes effect without resetting credits or requiring OAuth');
 const form=new FormData();form.append('file',new File([await readFile('public/images/family.png')],'fictional-family.png',{type:'image/png'}));form.append('ai','true');
 const photo=(await(await expect('v1','photos',201,'POST',form,member)).json()).id;
 const imageResponse=await expect('v1','photos/'+photo,200,'GET',undefined,member,{Origin:frontend});
 ok(imageResponse.headers.get('Access-Control-Allow-Origin')===frontend&&(await imageResponse.arrayBuffer()).byteLength>0,'authenticated image bytes and CORS survive response wrapping');
 await expect('v1','photos/'+photo,404,'GET',undefined,owner);
 const made=(await(await expect('v1','albums',201,'POST',{title:'邮箱账号相册',subtitle:'虚构素材',theme:'linen',mode:'book',pages:[{photoId:photo,caption:'第一页'},{photoId:photo,caption:'第二页'}]},member)).json()).id;
 await expect('v1','exports/'+made,200,'POST',{format:'pdf'},member);
 const share=(await(await expect('v1','albums/'+made+'/share',200,'PUT',{visibility:'unlisted',password:'test-1234'},member)).json()).token;
 await expect('v1','shared/'+share,423);
 const unlocked=await expect('v1','shared/'+share+'/unlock',200,'POST',{password:'test-1234'});
 const shared=await(await expect('v1','shared/'+share,200,'GET',undefined,cookies(unlocked))).json();ok(shared.album.pages.map(p=>p.caption).join(',')==='第一页,第二页','shared album preserves page order');
 await expect('auth','admin/accounts',200,'POST',{userId:newAccount.id,status:'suspended',note:'暂停测试'},owner);
 await expect('v1','photos/'+photo,401,'GET',undefined,member);
 ok(database.prepare('SELECT COUNT(*) AS n FROM photos WHERE owner=?').get(newAccount.id).n===1,'suspension never deletes photos');
 const suspendedLogin=await send('new@example.test','login');const suspendedResponse=await expect('auth','verify',200,'POST',suspendedLogin),suspended=cookies(suspendedResponse);
 await expect('v1','photos',403,'POST',{},suspended);
 await expect('auth','admin/accounts',200,'POST',{userId:newAccount.id,status:'approved'},owner);
 ok((await(await expect('v1','state',200,'GET',undefined,suspended)).json()).user.credits===2,'reactivation does not grant credits again');
 const logout=await expect('auth','logout',200,'POST',{},suspended);const loggedOut=cookies(logout);
 ok((await(await expect('auth','status',200,'GET',undefined,loggedOut,legacy)).json()).account===null,'logout prevents fallback to a leftover ChatGPT session');
 await expect('v1','photos/'+photo,401,'GET',undefined,suspended);
 const again=await send('new@example.test','login');const relogin=await expect('auth','verify',200,'POST',again);const restored=(await(await expect('v1','state',200,'GET',undefined,cookies(relogin))).json());
 ok(restored.albums[0].id===made&&restored.photos[0].id===photo&&restored.user.credits===2,'email relogin preserves albums, photos and credits');
 const invalid=await send('invalid@example.test');for(let i=0;i<5;i++)await expect('auth','verify',400,'POST',{...invalid,code:invalid.code==='000000'?'111111':'000000'});await expect('auth','verify',400,'POST',invalid);
 const expired=await send('expired@example.test');database.prepare('UPDATE email_codes SET expires=0 WHERE id=?').run(expired.challengeId);await expect('auth','verify',400,'POST',expired);
 const limited=await send('limited@example.test');await expect('auth','request-code',429,'POST',{email:'limited@example.test',purpose:'login'});
 const countBefore=database.prepare('SELECT COUNT(*) AS n FROM email_codes').get().n;freshLimits();mailFails=true;await expect('auth','request-code',502,'POST',{email:'delivery@example.test',purpose:'login'});mailFails=false;ok(database.prepare('SELECT COUNT(*) AS n FROM email_codes').get().n<=countBefore,'failed delivery leaves no usable challenge');
 delete env.RESEND_API_KEY;await expect('auth','request-code',503,'POST',{email:'missing@example.test',purpose:'login'});env.RESEND_API_KEY='test-secret-not-real';
 await expect('auth','admin/accounts',400,'POST',{userId:ownerAccount.id,status:'suspended'},owner);
 ok(database.prepare('SELECT COUNT(*) AS n FROM account_reviews WHERE user_id=?').get(newAccount.id).n===3,'review history is auditable');
 ok(database.prepare("SELECT credits FROM users WHERE id='legacy-owner'").get().credits===17&&database.prepare("SELECT pages FROM albums WHERE id='original-album'").get().pages.includes('原页序'),'original account remains unchanged after whole workflow');
 console.log(JSON.stringify({success:true,checks,scope:'actual auth and album HTTP handlers, SQLite migrations, verified email simulation, approval, sessions, data ownership, share/export authorization; no real mail or browser'}));
}finally{globalThis.fetch=oldFetch;delete globalThis.__authTest;database.close();}
