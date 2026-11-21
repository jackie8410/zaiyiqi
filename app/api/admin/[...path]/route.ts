import {withCors} from '@/lib/cors';
import {currentUser, HttpError, json, sameOrigin} from '@/lib/server';
import {withWriteLease} from '@/lib/maintenance';
import {publicModelSettings, saveModelSettings} from '@/lib/model-settings';
import {administrationStatus, backupFile, beginBackup, beginRestore, cancelOperation, commitRestore, finishBackup, operationHeartbeat, previewRestore, restoreFile} from '@/lib/admin-backup';
import {METADATA_LIMIT, PHOTO_LIMIT} from '@/lib/backup-format';
export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{path: string[]}>};
async function limitedBytes(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new HttpError('上传内容过大', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const {value, done} = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) {await reader.cancel(); throw new HttpError('上传内容过大', 413);}
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of chunks) {bytes.set(part, offset); offset += part.length;}
  return bytes;
}
async function payload(request: Request, limit = METADATA_LIMIT) {
  try {return JSON.parse(new TextDecoder().decode(await limitedBytes(request, limit)));}
  catch (e) {if (e instanceof HttpError) throw e; throw new HttpError('请求格式不正确');}
}
async function handle(request: Request, context: Ctx) {
  try {
    const user = (await currentUser(true, request))!;
    if (!user.admin) throw new HttpError('仅网站所有者可以使用管理工具', 403);
    if (request.method !== 'GET') sameOrigin(request);
    const {path} = await context.params, [area, id, action, photoId] = path, method = request.method;
    if (area === 'status' && method === 'GET') return json(await administrationStatus());
    if (area === 'model') {
      if (method === 'GET') return json(await publicModelSettings());
      if (method === 'PUT') return json(await withWriteLease(() => payload(request, 8192).then(data => saveModelSettings(user.id, data))));
    }
    if (area === 'backup') {
      if (id === 'start' && method === 'POST') return json(await beginBackup(user.id));
      if (action === 'file' && photoId && method === 'GET') return backupFile(id, user.id, photoId);
      if (action === 'finish' && method === 'POST') return json(await finishBackup(id, user.id));
    }
    if (area === 'restore') {
      if (id === 'preview' && method === 'POST') return json(await previewRestore(await payload(request)));
      if (id === 'start' && method === 'POST') return json(await beginRestore(user.id, await payload(request)));
      if (action === 'file' && photoId && method === 'PUT') return json(await restoreFile(id, user.id, photoId, await limitedBytes(request, PHOTO_LIMIT)));
      if (action === 'commit' && method === 'POST') return json(await commitRestore(id, user.id, (await payload(request, 1024)).confirm));
    }
    if (area === 'operations' && action === 'heartbeat' && method === 'POST') return json(await operationHeartbeat(id, user.id));
    if (area === 'operations' && method === 'DELETE') return json(await cancelOperation(id, user.id));
    throw new HttpError('接口不存在', 404);
  } catch (e) {
    // Validation messages contain schema/table names only; never echo secret or photo bytes.
    const known = e instanceof HttpError;
    return json({error: known ? e.message : e instanceof Error && /备份|相册|记录|照片|恢复|JSON/.test(e.message) ? e.message : '管理操作暂未完成，请稍后再试'}, known ? e.status : 400);
  }
}
const endpoint = withCors(handle);
export const GET = endpoint; export const POST = endpoint; export const PUT = endpoint; export const DELETE = endpoint; export const OPTIONS = endpoint;
