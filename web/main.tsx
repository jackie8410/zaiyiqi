import {createRoot} from 'react-dom/client';
import Studio from '@/components/studio';
import AccountPortal from '@/components/account-portal';
import SharedAlbum from '@/components/shared-album';
import Privacy from '@/app/privacy/page';
import '@/app/globals.css';
import '@/app/album.css';

const path = window.location.pathname.replace(/\/$/, '');
const token = new URLSearchParams(window.location.search).get('album');
const content = path === '/account' ? <AccountPortal/>
  : path === '/privacy' ? <Privacy/>
  : token ? <SharedAlbum token={token}/>
  : <Studio/>;
createRoot(document.getElementById('root')!).render(content);
