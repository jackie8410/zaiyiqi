declare module '*?raw' {const content:string;export default content;}
declare module 'qrcode' {const value:{toDataURL:(value:string,options?:any)=>Promise<string>};export default value;}

declare module 'page-flip';
