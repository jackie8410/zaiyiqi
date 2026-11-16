// Only this public origin is compiled into the Pages bundle. Service keys stay on the server.
declare const __ALBUM_API_ORIGIN__: string | undefined;
export function apiUrl(path: string) {
  if (!path.startsWith('/api/')) throw new Error('无效的服务地址');
  const origin = typeof __ALBUM_API_ORIGIN__ === 'string' ? __ALBUM_API_ORIGIN__ : '';
  return origin + path;
}
// Query-based links load a real Pages index.html, including on a fresh visit or refresh.
export function shareUrl(token: string) {
  return window.location.origin + '/?album=' + encodeURIComponent(token);
}
