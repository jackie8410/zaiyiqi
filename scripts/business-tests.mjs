import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign,createCipheriv,randomBytes} from 'node:crypto';
import ts from 'typescript';
const database=new DatabaseSync(':memory:');database.exec(await readFile('drizzle/0000_mysterious_kid_colt.sql','utf8'));
const adapter={prepare(sql){return {values:[],bind(...args){this.values=args;return this;},async first(){return database.prepare(sql).get(...this.values)||null;},async run(){return database.prepare(sql).run(...this.values);}};},async batch(list){database.exec('BEGIN');try{const results=[];for(const s of list)results.push(await s.run());database.exec('COMMIT');return results;}catch(e){database.exec('ROLLBACK');throw e;}}};
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const env={ALIPAY_APP_ID:'test-app',ALIPAY_SELLER_ID:'test-seller',ALIPAY_PRIVATE_KEY:rsa.privateKey,ALIPAY_PUBLIC_KEY:rsa.publicKey,WECHAT_MCH_ID:'test-mch',WECHAT_APP_ID:'test-wx-app',WECHAT_SERIAL_NO:'test-serial',WECHAT_PRIVATE_KEY:rsa.privateKey,WECHAT_API_V3_KEY:randomBytes(24).toString('base64'),WECHAT_PLATFORM_PUBLIC_KEY:rsa.publicKey,WECHAT_PLATFORM_SERIAL:'test-platform'};
class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
globalThis.__albumTest={bindings:()=>env,db:()=>adapter,HttpError,now:()=>Date.now(),uid:()=>crypto.randomUUID().replaceAll('-','')};
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const prompts='data:text/javascript;base64,'+Buffer.from(transpile(await readFile('lib/prompts.ts','utf8'))).toString('base64');
const source=transpile(await readFile('lib/payments.ts','utf8')).replace(/import \{[^}]+\} from ['"]\.\/server['"];?/,'const {bindings,db,HttpError,now,uid}=globalThis.__albumTest;').replace(/['"]\.\/prompts['"]/,JSON.stringify(prompts));
const {handleNotification,paymentChannels}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {creationPrompt,canRetry,validImage}=await import(prompts);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const order=(id,channel='alipay',amount=990,product='trial')=>database.prepare("INSERT INTO orders(id,owner,product,channel,amount,status,created) VALUES(?,?,?,?,?,'pending',?)").run(id,'test-owner',product,channel,amount,Date.now());
database.prepare("INSERT INTO users(id,name,credits,pro_until,created) VALUES('test-owner','test',0,0,?)").run(Date.now());
const credits=()=>database.prepare("SELECT credits FROM users WHERE id='test-owner'").get().credits;
function ali(values,badSignature=false){const p={app_id:env.ALIPAY_APP_ID,seller_id:env.ALIPAY_SELLER_ID,trade_status:'TRADE_SUCCESS',total_amount:'9.90',out_trade_no:'ali-1',trade_no:'ali-txn-1',...values};const canonical=Object.keys(p).sort().map(k=>k+'='+p[k]).join('&');p.sign=badSignature?'not-a-signature':createSign('RSA-SHA256').update(canonical).sign(rsa.privateKey,'base64');p.sign_type='RSA2';return new Request('https://example.invalid/api/v1/notify/alipay',{method:'POST',body:new URLSearchParams(p)});}
order('ali-1');ok((await handleNotification('alipay',ali({},true))).status===400,'reject invalid signature');ok(credits()===0,'invalid signature adds no credit');
ok((await handleNotification('alipay',ali({total_amount:'0.01'}))).status===400,'reject wrong amount');
ok((await handleNotification('alipay',ali({seller_id:'other'}))).status===400,'reject wrong seller');
ok((await handleNotification('alipay',ali({}))).status===200,'valid payment');ok(credits()===3,'grant exact product amount');
await Promise.all([handleNotification('alipay',ali({})),handleNotification('alipay',ali({}))]);ok(credits()===3,'repeat notifications are idempotent');
order('ali-2');ok((await handleNotification('alipay',ali({out_trade_no:'ali-2'}))).status===400,'prevent transaction reuse');ok(credits()===3,'duplicate transaction rolls back credit grant');
order('wx-1','wechat',2990,'keepsake');
function wx(amount=2990,badSignature=false){const timestamp=String(Math.floor(Date.now()/1000)),nonce='signed-nonce',resourceNonce='0123456789ab',aad='transaction';const content={mchid:env.WECHAT_MCH_ID,appid:env.WECHAT_APP_ID,trade_state:'SUCCESS',out_trade_no:'wx-1',transaction_id:'wx-txn-1',amount:{total:amount,currency:'CNY'}};const cipher=createCipheriv('aes-256-gcm',Buffer.from(env.WECHAT_API_V3_KEY),Buffer.from(resourceNonce));cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(JSON.stringify(content)),cipher.final(),cipher.getAuthTag()]);const raw=JSON.stringify({resource:{algorithm:'AEAD_AES_256_GCM',nonce:resourceNonce,associated_data:aad,ciphertext:bytes.toString('base64')}});const signature=createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${raw}\n`).sign(rsa.privateKey,'base64');return new Request('https://example.invalid/api/v1/notify/wechat',{method:'POST',headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':env.WECHAT_PLATFORM_SERIAL,'wechatpay-signature':badSignature?'invalid':signature},body:raw});}
ok((await handleNotification('wechat',wx(2990,true))).status===400,'reject forged WeChat notification');
ok((await handleNotification('wechat',wx(1))).status===400,'reject incorrect WeChat amount');
ok((await handleNotification('wechat',wx())).status===204,'valid signed encrypted WeChat notification');ok(credits()===15,'exact credit entitlement');
const expires=database.prepare("SELECT pro_until FROM users WHERE id='test-owner'").get().pro_until;ok(expires>Date.now()+29*86400000,'activate 30 day plan');await handleNotification('wechat',wx());ok(credits()===15,'WeChat notification is idempotent');ok(database.prepare("SELECT pro_until FROM users WHERE id='test-owner'").get().pro_until===expires,'duplicate does not extend plan');
ok(paymentChannels().length===2,'credential configuration');
ok(canRetry(2,'complete')&&!canRetry(3,'complete')&&!canRetry(1,'running'),'retry cap');
ok(validImage(Uint8Array.from([255,216,255]),'image/jpeg')&&!validImage(new Uint8Array(10),'image/png'),'format signature');
const prompt=creationPrompt({kind:'reunion',scene:'garden',outfit:'original',placement:'left',style:'natural',notes:'keep smiles',preserveAge:true});ok(prompt.includes('BASE group photo')&&prompt.includes('Preserve every existing face')&&prompt.includes('Preserve natural wrinkles'),'identity preserving composition instructions');

const creditSource=transpile(await readFile('lib/job-credits.ts','utf8')).replace(/import \{[^}]+\} from ['\"]\.\/server['\"];?/,'const {db,now,HttpError}=globalThis.__albumTest;');
const {reserveJobCredit,refundJobCredit,recoverStalledJobs}=await import('data:text/javascript;base64,'+Buffer.from(creditSource).toString('base64'));
database.prepare("INSERT INTO jobs(id,owner,kind,config,sources,results,attempts,status,charged,created,updated) VALUES('job-test','test-owner','travel','{}','[]','[]',0,'running',0,?,?)").run(Date.now(),Date.now());
await reserveJobCredit('job-test','test-owner');ok(credits()===14,'reserve once on first generation');
await refundJobCredit('job-test','test-owner');await refundJobCredit('job-test','test-owner');ok(credits()===15,'refund only once after technical failure');
await reserveJobCredit('job-test','test-owner');database.prepare("UPDATE jobs SET updated=? WHERE id='job-test'").run(Date.now()-310000);
await recoverStalledJobs('test-owner');await recoverStalledJobs('test-owner');ok(credits()===15,'recover abandoned request exactly once');ok(database.prepare("SELECT status FROM jobs WHERE id='job-test'").get().status==='failed','stalled task can retry');
console.log(JSON.stringify({success:true,checks,scope:'in-memory payment signature, amount, replay, atomic rollback, entitlement and prompt tests; no provider calls'}));
database.close();delete globalThis.__albumTest;
