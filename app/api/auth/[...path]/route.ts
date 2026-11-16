import {db,bindings,body,sameOrigin,json,HttpError,rateLimit,hash} from '@/lib/server';
import {resolveAccount,resolveLegacyAccount,publicAccount,requestEmailCode,verifyEmailCode,sessionCookie,logoutAccount,reviewAccounts,sessionForAccount,legacyOffCookie} from '@/lib/account-auth';
import {emailReady} from '@/lib/email';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{path:string[]}>};
async function authBody(request:Request){const raw=await request.text();if(raw.length>8192)throw new HttpError('申请内容过长',413);try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new HttpError('请求格式不正确');}}
async function handle(request:Request,context:Ctx){try{
 const {path}=await context.params,action=path.join('/');
 if(request.method!=='GET'){
  sameOrigin(request);
  if(Number(request.headers.get('content-length')||0)>8192)throw new HttpError('申请内容过长',413);
 }
 if(action==='status'&&request.method==='GET')return json({account:publicAccount(await resolveAccount(request)),emailReady:emailReady()&&String(bindings().AUTH_SECRET||'').length>=32,phoneReady:false});
 if(action==='request-code'&&request.method==='POST')return json(await requestEmailCode(request,await authBody(request)));
 if(action==='verify'&&request.method==='POST'){
  await rateLimit('auth-verify:'+await hash(request.headers.get('cf-connecting-ip')||'local'),50,600);
  const {user,token}=await verifyEmailCode(await authBody(request));
  const headers=new Headers({'Cache-Control':'private, no-store'});headers.append('Set-Cookie',sessionCookie(token,request));headers.append('Set-Cookie',legacyOffCookie(request));
  return Response.json({account:publicAccount(user)},{headers});
 }
 if(action==='legacy-link'&&request.method==='POST'){
  const user=await resolveLegacyAccount();if(!user)throw new HttpError('未找到已登录的旧版账号，请从原账号关联入口继续',401);
  const token=await sessionForAccount(user),headers=new Headers({'Cache-Control':'private, no-store'});headers.append('Set-Cookie',sessionCookie(token,request));headers.append('Set-Cookie',legacyOffCookie(request));
  return Response.json({account:publicAccount(user)},{headers});
 }
 if(action==='logout'&&request.method==='POST'){
  await logoutAccount(request);const headers=new Headers({'Cache-Control':'private, no-store'});headers.append('Set-Cookie',sessionCookie('',request,true));headers.append('Set-Cookie',legacyOffCookie(request));
  return Response.json({ok:true},{headers});
 }
 if(action==='admin/accounts'){
  const user=await resolveAccount(request);if(!user?.admin||user.status!=='approved')throw new HttpError('没有审核权限',403);
  if(request.method==='POST')return json(await reviewAccounts(user,await authBody(request)));
  if(request.method==='GET'){
   const status=new URL(request.url).searchParams.get('status')||'pending';if(!['pending','approved','rejected','suspended'].includes(status))throw new HttpError('筛选状态不正确');
   const rows=await db().prepare('SELECT a.user_id AS id,a.email,a.status,a.application,a.review_note AS reviewNote,a.created,a.reviewed_at AS reviewedAt,u.name,u.credits FROM email_accounts a JOIN users u ON u.id=a.user_id WHERE a.status=? ORDER BY a.created DESC LIMIT 100').bind(status).all();
   return json({accounts:rows.results});
  }
 }
 throw new HttpError('接口不存在',404);
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);console.error('account request failed');return json({error:'账户服务暂时不可用，请稍后重试'},500);}}
export const GET=handle;
export const POST=handle;
