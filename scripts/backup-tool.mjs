#!/usr/bin/env node
// Usage: node scripts/backup-tool.mjs inspect <zip-or-folder>
//        node scripts/backup-tool.mjs restore <zip-or-folder> <NEW-empty-directory>
import {readFile, readdir, stat, mkdir, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import JSZip from 'jszip';
import {createLocalStorage} from './storage-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({stdin: {contents: "export * from './lib/backup-format.ts';export * from './lib/restore-portable.ts';", resolveDir: root}, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent'});
const {validatePackage, sha256, restoreToEmpty, METADATA_LIMIT, PHOTO_LIMIT, ZIP_LIMIT} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const [command, source, destination] = process.argv.slice(2);
if (!['inspect', 'restore'].includes(command) || !source || (command === 'restore' && !destination)) {
  console.error('用法：node scripts/backup-tool.mjs inspect <备份ZIP或文件夹>\n      node scripts/backup-tool.mjs restore <备份ZIP或文件夹> <全新恢复目录>'); process.exit(2);
}
let local;
try {
  const inputPath = path.resolve(source), input = await stat(inputPath);
  let read;
  if (input.isDirectory()) {
    read = async (name, limit = PHOTO_LIMIT) => {
      if (!/^(manifest\.json|records\.json|files\/[0-9]{1,8}\.bin)$/.test(name)) throw new Error('备份路径不正确');
      const target = path.resolve(inputPath, ...name.split('/'));
      if (!target.startsWith(inputPath + path.sep) || (await lstat(target)).isSymbolicLink()) throw new Error('不安全的备份路径');
      if (name.startsWith('files/') && (await lstat(path.join(inputPath, 'files'))).isSymbolicLink()) throw new Error('不安全的备份目录');
      if ((await stat(target)).size > limit) throw new Error('备份文件过大');
      return new Uint8Array(await readFile(target));
    };
  } else {
    if (input.size > ZIP_LIMIT) throw new Error('ZIP 超过 256 MB，请使用文件夹备份');
    const zip = await JSZip.loadAsync(await readFile(inputPath), {createFolders: false});
    read = async (name, limit = PHOTO_LIMIT) => {
      const item = zip.file(name);
      if (!item || (item.unsafeOriginalName && item.unsafeOriginalName !== name) || item._data?.uncompressedSize > limit) throw new Error('备份缺失、路径不正确或文件过大：' + name);
      const bytes = await item.async('uint8array'); if (bytes.length > limit) throw new Error('文件过大'); return bytes;
    };
  }
  const decode = async name => JSON.parse(new TextDecoder().decode(await read(name, METADATA_LIMIT)));
  const data = await validatePackage(await decode('manifest.json'), await decode('records.json'));
  for (const file of data.manifest.files) {
    const bytes = await read(file.path);
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) throw new Error('原文件校验失败：' + file.path);
  }
  if (command === 'inspect') console.log(JSON.stringify({ok: true, created: data.manifest.created, counts: data.manifest.counts, photoBytes: data.manifest.files.reduce((n, f) => n + f.size, 0)}, null, 2));
  else {
    const output = path.resolve(destination);
    const exists = await stat(output).then(() => true).catch(e => {if (e.code === 'ENOENT') return false; throw e;});
    if (exists && ((await lstat(output)).isSymbolicLink() || (await readdir(output)).length)) throw new Error('恢复目录必须为空且不能是符号链接；现有内容未修改');
    await mkdir(output, {recursive: true});
    local = await createLocalStorage(output);
    const journal = JSON.parse(await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries) local.connection.exec(await readFile(path.join(root, 'drizzle', entry.tag + '.sql'), 'utf8'));
    const result = await restoreToEmpty(local, data, read);
    console.log(JSON.stringify({ok: true, restoredTo: output, ...result, note: '数据已恢复到独立 SQLite 数据库与照片目录，未连接或修改线上服务器。请在新服务器重新配置邮箱、管理员及模型密钥。'}, null, 2));
  }
} catch (e) {console.error('备份工具：' + e.message); process.exitCode = 1;}
finally {local?.close();}
