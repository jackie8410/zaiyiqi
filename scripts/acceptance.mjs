// Local API acceptance: creates and removes only its own temporary records.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('This acceptance script is restricted to the local test environment.');
let cookie='',photoId='',albumId='',commentId='';let checks=0;
async function request(path,method='GET',body,auth=true,extra={}){const headers={...extra};if(auth&&cookie)headers.Cookie=cookie;if(method!=='GET'&&!headers.Origin)headers.Origin=base;if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const response=await fetch(base+'/api/v1'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return response;}
async function expect(path,status,method='GET',body,auth=true,extra={}){const r=await request(path,method,body,auth,extra);assert.equal(r.status,status,`${method} ${path.split('?')[0]} expected ${status}, got ${r.status}: ${r.status===status?'':await r.text()}`);checks++;return r;}
try{
 await expect('/state',200,'GET',undefined,false);
 await expect('/photos',401,'POST',{},false);
 const signin=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});assert.equal(signin.status,302);cookie=signin.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');assert.ok(cookie);checks++;
 const state=await(await expect('/state',200)).json();assert.equal(state.user.id,'local_seedy');const credits=state.user.credits;checks++;
 const invalid=new FormData();invalid.append('file',new File(['not an image'],'invalid.png',{type:'image/png'}));await expect('/photos',400,'POST',invalid);
 const f=new FormData();f.append('file',new File([await readFile('public/images/family.png')],'QA-AI-虚构人物.png',{type:'image/png'}));f.append('ai','true');photoId=(await(await expect('/photos',201,'POST',f)).json()).id;
 await expect('/photos/'+photoId,200);
 await expect('/photos/'+photoId,401,'GET',undefined,false);
 const a={title:'QA-'+Date.now(),subtitle:'自动验收临时相册',theme:'linen',mode:'book',pages:[{photoId,caption:'AI生成虚构示例'}]};
 await expect('/albums',403,'POST',{...a,pages:[{photoId:'someone-elses-photo',caption:''}]});
 albumId=(await(await expect('/albums',201,'POST',a)).json()).id;
 await expect('/albums/'+albumId,409,'PATCH',{...a,revision:99});
 await expect('/albums/'+albumId,200,'PATCH',{...a,revision:1});
 await expect('/albums/'+albumId,409,'PATCH',{...a,revision:1});
 await expect('/exports/'+albumId,200,'POST',{format:'pdf'});
 await expect('/exports/'+albumId,403,'POST',{format:'html'});
 await expect('/exports/'+albumId,403,'POST',{format:'mp4'});
 await expect('/albums/'+albumId+'/share',400,'PUT',{visibility:'public',consent:false});
 const share=(await(await expect('/albums/'+albumId+'/share',200,'PUT',{visibility:'unlisted',password:'test-pass-7429'})).json()).token;
 await expect('/shared/'+share,423,'GET',undefined,false);
 await expect('/photos/'+photoId+'?share='+share,423,'GET',undefined,false);
 await expect('/shared/'+share+'/unlock',403,'POST',{password:'wrong'},false);
 const unlock=await expect('/shared/'+share+'/unlock',200,'POST',{password:'test-pass-7429'},false);const passCookie=unlock.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 await expect('/shared/'+share,200,'GET',undefined,false,{Cookie:passCookie});
 await expect('/photos/'+photoId+'?share='+share,200,'GET',undefined,false,{Cookie:passCookie});
 await expect('/shared/'+share+'/comments',401,'POST',{body:'not logged in'},false,{Cookie:passCookie});
 await expect('/albums/'+albumId+'/share',200,'PUT',{visibility:'public',consent:true});
 await expect('/shared/'+share,200,'GET',undefined,false);
 await expect('/shared/'+share+'/rate',400,'POST',{score:99});
 await expect('/shared/'+share+'/rate',200,'POST',{score:4});
 await expect('/shared/'+share+'/rate',200,'POST',{score:5});
 await expect('/shared/'+share+'/like',200,'POST',{});
 await expect('/shared/'+share+'/comments',200,'POST',{body:'QA test <script>alert(1)</script>'});
 const shared=await(await expect('/shared/'+share,200)).json();assert.equal(shared.rating,5);assert.equal(shared.ratingCount,1);assert.equal(shared.likes,1);assert.equal(shared.comments[0].body,'QA test <script>alert(1)</script>');commentId=shared.comments[0].id;checks+=4;
 await expect('/comments/'+commentId,200,'DELETE');commentId='';
 await expect('/albums/'+albumId+'/share',200,'PUT',{visibility:'private'});
 await expect('/shared/'+share,404,'GET',undefined,false,{Cookie:passCookie});
 await expect('/photos/'+photoId+'?share='+share,404,'GET',undefined,false,{Cookie:passCookie});
 await expect('/orders',503,'POST',{product:'trial',channel:'wechat'});
 await expect('/jobs',503,'POST',{requestId:crypto.randomUUID(),consent:true,sources:[photoId],config:{kind:'travel'}});
 const after=await(await expect('/state',200)).json();assert.equal(after.user.credits,credits);checks++;
 await expect('/photos/'+photoId,409,'DELETE');
 await expect('/photos/'+photoId+'?confirm=1',200,'DELETE');const removed=photoId;photoId='';await expect('/photos/'+removed,404);
 const afterDelete=await(await expect('/state',200)).json();assert.equal(afterDelete.albums.find(x=>x.id===albumId).pages.length,0);checks++;
 await expect('/albums/'+albumId,200,'DELETE');albumId='';
 // Origin guard uses a different origin without modifying browser state.
 await expect('/profile',403,'PATCH',{name:'must not change'},true,{Origin:'https://invalid.example'}).catch(async e=>{throw e;});
 console.log(JSON.stringify({success:true,checks,scope:'local API; no live AI or payment call',cleanup:'temporary records removed'}));
}finally{if(commentId)await request('/comments/'+commentId,'DELETE');if(albumId)await request('/albums/'+albumId,'DELETE');if(photoId)await request('/photos/'+photoId+'?confirm=1','DELETE');}
