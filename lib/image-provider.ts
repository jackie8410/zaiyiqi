import { bindings, HttpError } from './server';
import { creationPrompt, type CreationConfig } from './prompts';
export function imageReady(){const e=bindings();return !!(e.OPENAI_API_KEY||e.ARK_API_KEY);}
export async function createImage(images:{bytes:ArrayBuffer;mime:string}[],config:CreationConfig,feedback:string){
 const e=bindings();if(!imageReady())throw new HttpError('AI创作服务尚未配置。你仍可上传照片、制作和分享相册。',503);
 const prompt=creationPrompt(config,feedback);let response:Response;
 if(e.ARK_API_KEY){const inputs=images.map(i=>`data:${i.mime};base64,${Buffer.from(i.bytes).toString('base64')}`);response=await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations',{method:'POST',headers:{Authorization:`Bearer ${e.ARK_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:e.ARK_IMAGE_MODEL||'doubao-seedream-4-5-251128',prompt,image:inputs,size:'2K',response_format:'b64_json',watermark:true,sequential_image_generation:'disabled'}),signal:AbortSignal.timeout(180000)});
 }else{const form=new FormData();form.set('model',e.OPENAI_IMAGE_MODEL||'gpt-image-2');form.set('prompt',prompt);form.set('size','1536x1024');form.set('quality','medium');form.set('n','1');form.set('output_format','jpeg');images.forEach((i,n)=>form.append('image[]',new Blob([i.bytes],{type:i.mime}),`reference-${n}.`+(i.mime==='image/png'?'png':i.mime==='image/webp'?'webp':'jpg')));response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${e.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(180000)});}
 const result:any=await response.json();if(!response.ok){const code=result?.error?.code;throw new HttpError(code==='content_policy_violation'?'这次请求无法生成，请调整照片或描述。没有扣除出图次数。':response.status===429?'图像服务繁忙或额度不足，请稍后再试。没有扣除出图次数。':'图像服务未能完成这次创作。没有扣除出图次数。',502);}
 const item=result.data?.[0];if(!item?.b64_json)throw new HttpError('图像服务未返回可保存的图片，没有扣除出图次数。',502);
 const bytes=Uint8Array.from(atob(item.b64_json),c=>c.charCodeAt(0));if(bytes.byteLength>25*1024*1024)throw new HttpError('生成图片过大，请重试',502);return {bytes,mime:bytes[0]===137?'image/png':'image/jpeg'};
}
