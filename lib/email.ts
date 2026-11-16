import {bindings} from './server';

export function emailReady(){const env=bindings();return !!(env.RESEND_API_KEY&&env.AUTH_EMAIL_FROM);}
export async function sendVerificationEmail(to:string,code:string,requestId:string){
 const env=bindings();
 if(!emailReady())throw new Error('Email service not configured');
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'auth-'+requestId},
  body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to:[to],subject:'在一起 · 邮箱验证码',text:`你正在注册或登录「在一起」相册。\n\n验证码：${code}\n\n10分钟内有效，只能使用一次。请在发起请求的页面输入，不要把验证码告诉他人。\n如果不是你本人操作，请忽略这封邮件。`,...(env.AUTH_EMAIL_REPLY_TO?{reply_to:env.AUTH_EMAIL_REPLY_TO}:{})}),
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw new Error('Email provider rejected request');
 const result=await response.json() as {id?:string};
 if(!result.id)throw new Error('Email provider did not acknowledge request');
}
