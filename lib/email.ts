import {bindings} from './server';

export function emailReady(){const env=bindings();return !!(env.RESEND_API_KEY&&env.AUTH_EMAIL_FROM);}
export async function sendVerificationEmail(to:string,code:string,requestId:string,purpose:'login'|'register'='login',sentAt=Date.now()){
 const env=bindings();
 if(!emailReady())throw new Error('Email service not configured');
 const action=purpose==='register'?'注册':'登录';
 const sentTime=new Date(sentAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'auth-'+requestId},
  body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to:[to],subject:`在一起 · ${action}验证码 · ${sentTime}`,text:`你正在${action}「在一起」相册。\n账号：${to}\n发送时间：${sentTime}（北京时间）\n\n验证码：${code}\n\n10分钟内有效，只能使用一次。请在发起请求的页面输入，不要把验证码告诉他人。\n如多次申请，请核对当前页面的发送时间，使用对应的最新验证码。\n如果不是你本人操作，请忽略这封邮件。`,...(env.AUTH_EMAIL_REPLY_TO?{reply_to:env.AUTH_EMAIL_REPLY_TO}:{})}),
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw new Error('Email provider rejected request');
 const result=await response.json() as {id?:string};
 if(!result.id)throw new Error('Email provider did not acknowledge request');
}
