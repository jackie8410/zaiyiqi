import SharedAlbum from '@/components/shared-album';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <SharedAlbum token={token}/>;}
