import { db,bucket,bindings,currentUser,body,text,owned,sameOrigin,uid,now,json,HttpError,rateLimit,hash,readableAlbum,photoDto,albumDto,jobDto } from '@/lib/server';
import { validImage,MAX_ATTEMPTS,PRODUCTS } from '@/lib/prompts';
import { createImage,imageReady } from '@/lib/image-provider';
import { paymentChannels,createPayment,handleNotification,queryPayment } from '@/lib/payments';
import {reserveJobCredit,refundJobCredit,recoverStalledJobs} from '@/lib/job-credits';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Ctx){try{
 const {path}=await context.params;const [area,id,action]=path;const method=request.method;const url=new URL(request.url);
 if(area==='notify'&&method==='POST')return handleNotification(id,request);
 if(method!=='GET')sameOrigin(request);
 if(area==='state'&&method==='GET'){
  const u=await currentUser(false);const config={ai:imageReady(),payments:bindings().PAYMENT_SALES_ENABLED==='true'?paymentChannels():[],products:PRODUCTS};
  if(!u)return json({user:null,photos:[],albums:[],jobs:[],config});
  await recoverStalledJobs(u.id);const balance:any=await db().prepare('SELECT credits FROM users WHERE id=?').bind(u.id).first();u.credits=balance.credits;
  const [p,a,j]=await Promise.all([db().prepare('SELECT * FROM photos WHERE owner=? ORDER BY created DESC').bind(u.id).all(),db().prepare('SELECT * FROM albums WHERE owner=? ORDER BY updated DESC').bind(u.id).all(),db().prepare('SELECT * FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 30').bind(u.id).all()]);
  return json({user:{id:u.id,name:u.name,credits:u.credits,pro:u.pro,proUntil:u.pro_until,admin:u.admin},photos:p.results.map(photoDto),albums:a.results.map(albumDto),jobs:j.results.map(jobDto),config});
 }
 if(area==='gallery'&&method==='GET'){
  const rows=await db().prepare("SELECT a.*,u.name,(SELECT COUNT(*) FROM likes WHERE album_id=a.id) AS likes FROM albums a JOIN users u ON a.owner=u.id WHERE a.visibility='public' AND a.password_hash IS NULL ORDER BY a.updated DESC LIMIT 60").all();
  return json(rows.results.map((a:any)=>({...albumDto(a),name:a.name,likes:a.likes})));}
 if(area==='shared'){
  if(action==='unlock'&&method==='POST'){
   await rateLimit('unlock:'+await hash((request.headers.get('cf-connecting-ip')||'local')+id),8,300);
   const a:any=await db().prepare("SELECT * FROM albums WHERE share_token=? AND visibility<>'private'").bind(id).first();if(!a)throw new HttpError('相册分享已失效',404);const b=await body(request);
   if(a.password_hash!==await hash(a.id+text(b.password,64)))throw new HttpError('访问密码不正确',403);
   const session=uid()+uid();await db().prepare('INSERT INTO share_sessions(id,album_id,expires) VALUES (?,?,?)').bind(session,a.id,now()+86400000).run();return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`album_${a.id}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`}});
  }
  const a=await readableAlbum(request,id);
  if(method==='GET'){
   const pages=JSON.parse(a.pages);const rows=await db().prepare('SELECT * FROM photos WHERE owner=?').bind(a.owner).all();const used=new Set(pages.map((p:any)=>p.photoId));const ps=rows.results.filter((p:any)=>used.has(p.id)).map((p:any)=>({...photoDto(p),url:`/api/v1/photos/${p.id}?share=${id}`}));
   const [cs,ls,owner]=await Promise.all([db().prepare('SELECT id,name,body,created,owner FROM comments WHERE album_id=? ORDER BY created DESC LIMIT 100').bind(a.id).all(),db().prepare('SELECT COUNT(*) AS n FROM likes WHERE album_id=?').bind(a.id).first(),db().prepare('SELECT name FROM users WHERE id=?').bind(a.owner).first()]);
   const u=await currentUser(false);const liked=u?await db().prepare('SELECT id FROM likes WHERE id=?').bind(a.id+':'+u.id).first():false;
   const stats:any=await db().prepare('SELECT AVG(score) AS rating,COUNT(*) AS n FROM ratings WHERE album_id=?').bind(a.id).first();const mine:any=u?await db().prepare('SELECT score FROM ratings WHERE id=?').bind(a.id+':'+u.id).first():null;
   return json({album:albumDto(a),photos:ps,comments:cs.results.map((c:any)=>({id:c.id,name:c.name,body:c.body,created:c.created,canDelete:!!u&&(u.id===c.owner||u.id===a.owner||u.admin)})),likes:(ls as any)?.n||0,liked:!!liked,rating:stats?.rating||0,ratingCount:stats?.n||0,myRating:mine?.score||0,author:(owner as any)?.name||'相册主人',user:u?{name:u.name,id:u.id}:null});
  }
  const u=(await currentUser())!;await rateLimit('social:'+u.id,10,60);
  if(action==='like'&&method==='POST'){const key=a.id+':'+u.id;const existing=await db().prepare('SELECT id FROM likes WHERE id=?').bind(key).first();if(existing)await db().prepare('DELETE FROM likes WHERE id=?').bind(key).run();else await db().prepare('INSERT INTO likes(id,album_id,owner) VALUES(?,?,?)').bind(key,a.id,u.id).run();return json({ok:true});}
  if(action==='rate'&&method==='POST'){const b=await body(request);if(!Number.isInteger(b.score)||b.score<1||b.score>5)throw new HttpError('请选择1至5星');await db().prepare('INSERT INTO ratings(id,album_id,owner,score) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET score=excluded.score').bind(a.id+':'+u.id,a.id,u.id,b.score).run();return json({ok:true});}
  if(action==='comments'&&method==='POST'){const b=await body(request);const value=text(b.body,500);if(!value)throw new HttpError('写下一句祝福再发送吧');await db().prepare('INSERT INTO comments(id,album_id,owner,name,body,created) VALUES(?,?,?,?,?,?)').bind(uid(),a.id,u.id,u.name,value,now()).run();return json({ok:true});}
 }
 if(area==='photos'&&id&&method==='GET'){
  const p:any=await db().prepare('SELECT * FROM photos WHERE id=?').bind(id).first();if(!p)throw new HttpError('照片不存在',404);
  if(url.searchParams.get('share')){const a=await readableAlbum(request,url.searchParams.get('share')!);if(!JSON.parse(a.pages).some((s:any)=>s.photoId===id))throw new HttpError('无权访问这张照片',403);}
  else{const u=(await currentUser())!;if(p.owner!==u.id)throw new HttpError('照片不存在',404);}
  const object=await bucket().get(p.object_key);if(!object)throw new HttpError('照片文件不存在',404);
  return new Response(object.body as BodyInit,{headers:{'Content-Type':p.mime,'Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':url.searchParams.has('download')?`attachment; filename="photo-${id}.${p.mime==='image/png'?'png':p.mime==='image/webp'?'webp':'jpg'}"`:'inline'}});
 }
 const u=(await currentUser())!;
 if(area==='profile'&&method==='PATCH'){const b=await body(request);const name=text(b.name,30);if(!name)throw new HttpError('昵称不能为空');await db().prepare('UPDATE users SET name=? WHERE id=?').bind(name,u.id).run();return json({ok:true});}
 if(area==='photos'&&method==='POST'){
  await rateLimit('upload:'+u.id,60,60);const count:any=await db().prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS bytes FROM photos WHERE owner=?').bind(u.id).first();if(count.n>=(u.pro?500:100)||count.bytes>(u.pro?2e9:3e8))throw new HttpError('照片池容量已满，请删除不需要的照片或升级',403);
  if(Number(request.headers.get('content-length')||0)>21*1024*1024)throw new HttpError('每张照片最多20MB',413);
  const data=await request.formData();const file=data.get('file');if(!(file instanceof File)||file.size>20*1024*1024||file.size<12)throw new HttpError('请选择20MB以内的JPG、PNG或WebP照片');
  if(count.bytes+file.size>(u.pro?2e9:3e8))throw new HttpError('照片池剩余空间不足',403);
  const bytes=new Uint8Array(await file.arrayBuffer());if(!validImage(bytes,file.type))throw new HttpError('照片格式不受支持，请使用JPG、PNG或WebP');
  const photoId=uid();const key=`${u.id}/${photoId}`;await bucket().put(key,bytes,{httpMetadata:{contentType:file.type}});
  try{await db().prepare('INSERT INTO photos(id,owner,object_key,name,mime,size,kind,created) VALUES(?,?,?,?,?,?,?,?)').bind(photoId,u.id,key,text(file.name,120),file.type,file.size,data.get('ai')==='true'?'ai':'original',now()).run();}catch(e){await bucket().delete(key);throw e;}
  return json({id:photoId},201);
 }
 if(area==='photos'&&id&&method==='DELETE'){
  const p=await owned('photos',id,u.id);const all=await db().prepare('SELECT id,pages FROM albums WHERE owner=?').bind(u.id).all();const linked=all.results.filter((a:any)=>JSON.parse(a.pages).some((p:any)=>p.photoId===id));
  if(linked.length&&!url.searchParams.has('confirm'))return json({error:'这张照片正在相册中使用。删除后会同时移除对应相册页。',linked:linked.length},409);
  await db().batch([...linked.map((a:any)=>db().prepare('UPDATE albums SET pages=?,updated=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(JSON.parse(a.pages).filter((p:any)=>p.photoId!==id)),now(),a.id)),db().prepare('DELETE FROM photos WHERE id=? AND owner=?').bind(id,u.id)]);await bucket().delete(p.object_key);return json({ok:true});
 }
 if(area==='albums'&&(method==='POST'||method==='PATCH')){
  const b=await body(request);if(!Array.isArray(b.pages)||b.pages.length<1||b.pages.length>(u.pro?200:20))throw new HttpError(u.pro?'请选择1—200张照片':'免费相册支持1—20张照片');
  const pages=b.pages.map((p:any)=>({photoId:text(p.photoId,64),caption:text(p.caption,120)}));const rows=await db().prepare('SELECT id FROM photos WHERE owner=?').bind(u.id).all();const ids=new Set(rows.results.map((p:any)=>p.id));if(pages.some((p:any)=>!ids.has(p.photoId)))throw new HttpError('相册包含不属于你的照片',403);
  const theme=['linen','forest','film','rose','ocean'].includes(b.theme)?b.theme:'linen';if(['rose','ocean'].includes(theme)&&!u.pro)throw new HttpError('这个主题属于珍藏计划',403);
  const mode=['book','fade','slide','zoom'].includes(b.mode)?b.mode:'book';const title=text(b.title,60,'我们的故事')||'我们的故事';const subtitle=text(b.subtitle,160);
  if(method==='POST'){const n:any=await db().prepare('SELECT COUNT(*) AS n FROM albums WHERE owner=?').bind(u.id).first();if(n.n>=(u.pro?100:5))throw new HttpError('在线相册数量已达上限',403);const key=uid();await db().prepare('INSERT INTO albums(id,owner,title,subtitle,theme,mode,pages,visibility,created,updated) VALUES(?,?,?,?,?,?,?,\'private\',?,?)').bind(key,u.id,title,subtitle,theme,mode,JSON.stringify(pages),now(),now()).run();return json({id:key},201);}
  await owned('albums',id,u.id);const changed=await db().prepare('UPDATE albums SET title=?,subtitle=?,theme=?,mode=?,pages=?,updated=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? RETURNING id').bind(title,subtitle,theme,mode,JSON.stringify(pages),now(),id,u.id,b.revision).first();if(!changed)throw new HttpError('相册已在其他窗口更新，请刷新后编辑',409);return json({ok:true});
 }
 if(area==='albums'&&method==='PUT'&&action==='share'){
  const a=await owned('albums',id,u.id);const b=await body(request);if(!['private','unlisted','public'].includes(b.visibility))throw new HttpError('分享范围不正确');
  if(b.visibility==='public'&&!b.consent)throw new HttpError('请确认照片中人物同意公开展示');
  const token=b.visibility==='private'?null:a.share_token||uid()+uid();const password=text(b.password,64);if(password&&password.length<4)throw new HttpError('访问密码至少4个字符');
  await db().batch([db().prepare('UPDATE albums SET visibility=?,share_token=?,password_hash=?,updated=? WHERE id=? AND owner=?').bind(b.visibility,token,b.visibility==='public'||!password?null:await hash(a.id+password),now(),id,u.id),db().prepare('DELETE FROM share_sessions WHERE album_id=?').bind(id)]);return json({token});
 }
 if(area==='albums'&&method==='DELETE'){
  await owned('albums',id,u.id);await db().batch(['comments','likes','ratings','share_sessions'].map(t=>db().prepare(`DELETE FROM ${t} WHERE album_id=?`).bind(id)).concat([db().prepare('DELETE FROM albums WHERE id=? AND owner=?').bind(id,u.id)]));return json({ok:true});
 }
 if(area==='exports'&&method==='POST'){await owned('albums',id,u.id);const b=await body(request);if(!['pdf','html','mp4'].includes(b.format))throw new HttpError('导出格式不正确');if(b.format!=='pdf'&&!u.pro)throw new HttpError('离线翻页和视频导出属于时光珍藏计划',403);return json({ok:true});}
 if(area==='comments'&&method==='DELETE'){const c:any=await db().prepare('SELECT c.*,a.owner AS album_owner FROM comments c JOIN albums a ON c.album_id=a.id WHERE c.id=?').bind(id).first();if(!c||!(c.owner===u.id||c.album_owner===u.id||u.admin))throw new HttpError('无权删除这条留言',403);await db().prepare('DELETE FROM comments WHERE id=?').bind(id).run();return json({ok:true});}
 if(area==='jobs'&&method==='POST'){
  if(!imageReady())throw new HttpError('AI创作服务尚未配置，请先使用照片池和相册功能。',503);await rateLimit('generate:'+u.id,8,300);const b=await body(request);let job:any;
  if(id){job=await owned('jobs',id,u.id);if(job.attempts>=MAX_ATTEMPTS)throw new HttpError('这份任务的3次出图已用完。你可以保留已有版本或开始新任务。',403);}
  else{
   if(!b.consent)throw new HttpError('请先确认照片使用授权');const sources=Array.isArray(b.sources)?b.sources.slice(0,6):[];if(!sources.length)throw new HttpError('请先选择照片');const config=b.config||{};if(!['reunion','travel','retouch'].includes(config.kind))throw new HttpError('创作类型不正确');if(config.kind==='reunion'&&sources.length<2)throw new HttpError('合影需要原合影和人物参考照，至少2张');for(const p of sources)await owned('photos',p,u.id);
   if(u.credits<1)throw new HttpError('创作任务额度已用完',402);const key=text(b.requestId,64);if(!/^[a-zA-Z0-9-]{16,64}$/.test(key))throw new HttpError('缺少请求编号');const exists=await db().prepare('SELECT id FROM jobs WHERE id=?').bind(key).first();if(exists)throw new HttpError('这次请求已提交，请查看创作记录',409);
   const clean={kind:config.kind,mode:config.mode==='new'?'new':'insert',scene:text(config.scene,200),outfit:text(config.outfit,200),placement:text(config.placement,120),style:text(config.style,100),notes:text(config.notes,1000),preserveAge:config.preserveAge!==false};
   await db().prepare('INSERT INTO jobs(id,owner,kind,config,sources,results,attempts,status,charged,created,updated) VALUES(?,?,?,?,?,\'[]\',0,\'ready\',0,?,?)').bind(key,u.id,clean.kind,JSON.stringify(clean),JSON.stringify(sources),now(),now()).run();job=await owned('jobs',key,u.id);
  }
  const lock=await db().prepare("UPDATE jobs SET status='running',updated=?,error=NULL WHERE id=? AND owner=? AND status<>'running' AND attempts<? RETURNING id").bind(now(),job.id,u.id,MAX_ATTEMPTS).first();if(!lock)throw new HttpError('任务正在生成，请稍候查看结果',409);
  let reserved=false;
  try{
   if(!job.charged){await reserveJobCredit(job.id,u.id);reserved=true;}
   const capacity:any=await db().prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS bytes FROM photos WHERE owner=?').bind(u.id).first();if(capacity.n>=(u.pro?500:100)||capacity.bytes+25*1024*1024>(u.pro?2e9:3e8))throw new HttpError('照片池空间不足，请先清理一些照片',403);
   const images=[];let total=0;for(const photoId of JSON.parse(job.sources)){const p=await owned('photos',photoId,u.id);total+=p.size;if(total>24*1024*1024)throw new HttpError('本次参考照片合计需小于24MB，请缩小照片后再试');const o=await bucket().get(p.object_key);if(!o)throw new HttpError('原始照片已删除');images.push({bytes:await o.arrayBuffer(),mime:p.mime});}
   const out=await createImage(images,JSON.parse(job.config),text(b.feedback,1000));
   const still=await db().prepare("SELECT id FROM jobs WHERE id=? AND owner=? AND status='running'").bind(job.id,u.id).first();if(!still)throw new HttpError('任务已取消，生成结果不会保存',409);
   const photoId=uid(),key=`${u.id}/${photoId}`;await bucket().put(key,out.bytes,{httpMetadata:{contentType:out.mime},customMetadata:{aiGenerated:'true',job:job.id}});
   const results=[...JSON.parse(job.results),photoId];
   try{const writes=await db().batch([db().prepare("INSERT INTO photos(id,owner,object_key,name,mime,size,kind,created) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner=? AND status='running')").bind(photoId,u.id,key,`${job.kind==='reunion'?'在一起合影':job.kind==='travel'?'旅行写真':'照片优化'} · 版本${job.attempts+1}`,out.mime,out.bytes.byteLength,'ai',now(),job.id,u.id),db().prepare("UPDATE jobs SET status='complete',charged=1,attempts=attempts+1,results=?,updated=? WHERE id=? AND owner=? AND status='running'").bind(JSON.stringify(results),now(),job.id,u.id)]);if(!writes[0].meta.changes)throw new HttpError('任务已取消，生成结果不会保存',409);}catch(e){await bucket().delete(key);throw e;}
   return json({id:job.id,photoId});
  }catch(e){if(reserved)await refundJobCredit(job.id,u.id);const message=e instanceof HttpError?e.message:'这次生成未完成，没有扣除出图次数。请稍后再试。';await db().prepare("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=? AND owner=?").bind(message,now(),job.id,u.id).run();throw new HttpError(message,e instanceof HttpError?e.status:502);}
 }
 if(area==='orders'&&method==='POST'){if(!imageReady()||bindings().PAYMENT_SALES_ENABLED!=='true')throw new HttpError('付费服务尚未开放，暂不收款',503);const b=await body(request);if(!Object.hasOwn(PRODUCTS,b.product))throw new HttpError('套餐不存在');if(!paymentChannels().includes(b.channel))throw new HttpError('这个支付渠道尚未开通',503);await rateLimit('payment:'+u.id,5,60);const product=PRODUCTS[b.product as keyof typeof PRODUCTS];const orderId=uid();await db().prepare('INSERT INTO orders(id,owner,product,channel,amount,status,created) VALUES(?,?,?,?,?,\'pending\',?)').bind(orderId,u.id,b.product,b.channel,product.amount,now()).run();const payment=await createPayment({id:orderId,amount:product.amount,name:product.name,channel:b.channel},request);return json({id:orderId,...payment});}
 if(area==='orders'&&method==='GET'){const order=await owned('orders',id,u.id);if(order.status!=='paid')await queryPayment(order);return json(await owned('orders',id,u.id));}
 if(area==='account'&&method==='DELETE'){
  const b=await body(request);if(b.confirm!=='删除全部作品')throw new HttpError('请输入“删除全部作品”确认');
  const as=await db().prepare('SELECT id FROM albums WHERE owner=?').bind(u.id).all();const statements=[db().prepare('UPDATE users SET credits=credits+(SELECT COUNT(*) FROM jobs WHERE owner=? AND charged=2) WHERE id=?').bind(u.id,u.id)];for(const a of as.results)for(const t of ['comments','likes','ratings','share_sessions'])statements.push(db().prepare(`DELETE FROM ${t} WHERE album_id=?`).bind(a.id));for(const t of ['photos','albums','jobs','comments','likes','ratings'])statements.push(db().prepare(`DELETE FROM ${t} WHERE owner=?`).bind(u.id));await db().batch(statements);
  let cursor:string|undefined;do{const list=await bucket().list({prefix:`${u.id}/`,cursor});if(list.objects.length)await bucket().delete(list.objects.map(o=>o.key));cursor=list.truncated?list.cursor:undefined;}while(cursor);return json({ok:true});
 }
 if(area==='admin'&&method==='GET'){if(!u.admin)throw new HttpError('没有管理权限',403);return json({ai:imageReady(),payments:paymentChannels(),configuration:['OPENAI_API_KEY','ARK_API_KEY','WECHAT_MCH_ID','WECHAT_PRIVATE_KEY','WECHAT_API_V3_KEY','WECHAT_PLATFORM_PUBLIC_KEY','ALIPAY_APP_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY'].map(key=>({key,configured:!!bindings()[key]}))});}
 throw new HttpError('接口不存在',404);
 }catch(e){return json({error:e instanceof HttpError?e.message:'操作暂未完成，请稍后再试。'},e instanceof HttpError?e.status:500);}}
export const GET=handle;export const POST=handle;export const PATCH=handle;export const PUT=handle;export const DELETE=handle;
