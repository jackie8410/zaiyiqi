import JSZip from 'jszip';
import {apiUrl} from './browser-urls';
import {canonical, METADATA_LIMIT, PHOTO_LIMIT, sha256, validatePackage, ZIP_LIMIT, type Manifest, type Records} from './backup-format';

export async function adminCall(path: string, method = 'GET', body?: unknown, raw = false): Promise<any> {
  const response = await fetch(apiUrl('/api/admin/' + path), {method, credentials: 'include',
    headers: body === undefined ? undefined : {'Content-Type': raw ? 'application/octet-stream' : 'application/json'},
    body: body === undefined ? undefined : raw ? body as BodyInit : JSON.stringify(body)});
  if (!response.ok) {const data: any = await response.json().catch(() => ({})); throw new Error(data.error || '管理请求未完成，请重试');}
  return response.json();
}
type Archive = {manifest: Manifest; records: Records; readPhoto: (path: string) => Promise<Uint8Array>};
export type LoadedBackup = Archive;
const limitFile = (size: number, limit: number) => {if (size > limit) throw new Error('备份文件超出此操作的大小上限');};
async function folderFile(root: any, path: string): Promise<File> {
  // Only fixed filenames or manifest-validated files/<index>.bin may reach here.
  if (!/^(manifest\.json|records\.json|files\/[0-9]{1,8}\.bin)$/.test(path)) throw new Error('备份文件路径不正确');
  const segments = path.split('/');
  let dir = root;
  if (segments.length === 2) dir = await dir.getDirectoryHandle(segments.shift());
  return (await dir.getFileHandle(segments[0])).getFile();
}
export async function readBackupZip(file: File): Promise<Archive> {
  limitFile(file.size, ZIP_LIMIT);
  const zip = await JSZip.loadAsync(file, {createFolders: false});
  const text = async (name: string) => {
    const item: any = zip.file(name); if (!item) throw new Error('备份缺少 ' + name);
    limitFile(item._data?.uncompressedSize || 0, METADATA_LIMIT);
    const bytes = await item.async('uint8array'); limitFile(bytes.length, METADATA_LIMIT);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const {manifest, records} = await validatePackage(await text('manifest.json'), await text('records.json'));
  if (manifest.files.reduce((n, f) => n + f.size, 0) > ZIP_LIMIT) throw new Error('较大的备份请使用文件夹恢复');
  const allowed = new Set(['manifest.json', 'records.json', 'README.txt', ...manifest.files.map(f => f.path)]);
  if (Object.values(zip.files).some(f => !f.dir && (!allowed.has(f.name) || (f as any).unsafeOriginalName !== undefined && (f as any).unsafeOriginalName !== f.name))) throw new Error('备份包含未知或不安全的文件路径');
  return {manifest, records, readPhoto: async path => {
    const item: any = zip.file(path); if (!item) throw new Error('照片原文件缺失：' + path);
    limitFile(item._data?.uncompressedSize || 0, PHOTO_LIMIT);
    const bytes = await item.async('uint8array'); limitFile(bytes.length, PHOTO_LIMIT); return bytes;
  }};
}
export async function readBackupFolder(root: any): Promise<Archive> {
  const manifestFile = await folderFile(root, 'manifest.json'), recordsFile = await folderFile(root, 'records.json');
  limitFile(manifestFile.size, METADATA_LIMIT); limitFile(recordsFile.size, METADATA_LIMIT);
  const data = await validatePackage(JSON.parse(await manifestFile.text()), JSON.parse(await recordsFile.text()));
  return {...data, readPhoto: async path => {const file = await folderFile(root, path); limitFile(file.size, PHOTO_LIMIT); return new Uint8Array(await file.arrayBuffer());}};
}
export async function verifyArchive(archive: Archive, progress: (value: string) => void, cancelled: () => boolean) {
  let i = 0;
  for (const entry of archive.manifest.files) {
    if (cancelled()) throw new Error('已取消检查');
    progress(`正在检查照片 ${++i} / ${archive.manifest.files.length}`);
    const bytes = await archive.readPhoto(entry.path);
    if (bytes.length !== entry.size || await sha256(bytes) !== entry.sha256) throw new Error(`照片 ${i} 校验失败，不能恢复这个备份`);
  }
}
export async function downloadBackup(options: {folder?: any; progress: (value: string) => void; cancelled: () => boolean; operation: (id: string | null) => void}) {
  let id: string | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, heartbeatError = '';
  const zip = options.folder ? null : new JSZip();
  let target: any;
  try {
    const start = await adminCall('backup/start', 'POST', {});
    id = start.id; options.operation(id!);
    heartbeat = setInterval(() => {adminCall(`operations/${id}/heartbeat`, 'POST', {}).catch(e => {heartbeatError = e.message;});}, 30_000);
    const manifest: Manifest = start.manifest, records: Records = start.records;
    const size = manifest.files.reduce((n, f) => n + f.size, 0);
    if (zip && size > ZIP_LIMIT - METADATA_LIMIT * 2) throw new Error('数据超过 ZIP 下载上限，请选择“备份到文件夹”，按张保存原文件。');
    if (options.folder) target = await options.folder.getDirectoryHandle(`在一起-完整备份-${new Date().toISOString().replace(/[:.]/g, '-')}-${id!.slice(0, 6)}`, {create: true});
    const save = async (path: string, bytes: string | Uint8Array) => {
      if (zip) {zip.file(path, bytes); return;}
      const parts = path.split('/'); let dir = target;
      if (parts.length === 2) dir = await target.getDirectoryHandle(parts.shift(), {create: true});
      const file = await dir.getFileHandle(parts[0], {create: true}), stream = await file.createWritable();
      try {await stream.write(bytes); await stream.close();} catch (e) {await stream.abort().catch(() => {}); throw e;}
    };
    let index = 0;
    for (const file of manifest.files) {
      if (options.cancelled()) throw new Error('已取消备份；未生成完整清单的文件夹不能用于恢复。');
      if (heartbeatError) throw new Error(heartbeatError);
      options.progress(`正在备份照片 ${++index} / ${manifest.files.length}`);
      const response = await fetch(apiUrl(`/api/admin/backup/${id}/file/${encodeURIComponent(file.photoId)}`), {credentials: 'include'});
      if (!response.ok) throw new Error((await response.json() as any).error || '照片下载失败');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== file.size) throw new Error('照片下载不完整，请重试');
      file.sha256 = await sha256(bytes); await save(file.path, bytes);
    }
    await validatePackage(manifest, records);
    options.progress('照片已校验，正在保存备份清单…');
    await save('records.json', canonical(records));
    await save('README.txt', '在一起完整数据备份\n包含用户、审批、额度、照片、相册、分享和互动记录及模型参数。\n不含服务器密钥、验证码、登录会话或站点源码。源码在 GitHub，密钥须在目标服务器重新配置。\n请妥善保存；文件内含私人照片与邮箱。\n使用网站所有者管理页先校验再恢复，或运行 scripts/backup-tool.mjs。\n');
    // Write the completion manifest last, so interrupted folder exports cannot look complete.
    await save('manifest.json', canonical(manifest));
    if (heartbeatError) throw new Error(heartbeatError);
    if (zip) {
      const blob = await zip.generateAsync({type: 'blob', compression: 'STORE'});
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `在一起-完整备份-${new Date(manifest.created).toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    await adminCall(`backup/${id}/finish`, 'POST', {}); id = undefined;
    return {photos: manifest.files.length, bytes: size};
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (id) await adminCall(`operations/${id}`, 'DELETE').catch(() => {});
    options.operation(null);
  }
}
