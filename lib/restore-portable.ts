import {insertStatements, sha256, TABLES, validatePackage, type Manifest, type Records} from './backup-format';
import type {StorageAdapter} from './storage/contracts';

// A hosting-independent recovery path. It deliberately refuses a non-empty target.
export async function restoreToEmpty(adapter: StorageAdapter, input: {manifest: Manifest; records: Records}, readFile: (path: string) => Promise<Uint8Array>) {
  const {manifest, records} = await validatePackage(input.manifest, input.records);
  for (const table of TABLES) {
    if (Number((await adapter.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())!.n)) throw new Error('目标数据库非空，禁止覆盖；请指定全新的恢复目录');
  }
  if ((await adapter.files.list({limit: 1})).objects.length) throw new Error('目标照片存储非空，禁止覆盖');
  // Verify the whole archive before the first write, including files near its end.
  for (const file of manifest.files) {
    const bytes = await readFile(file.path);
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) throw new Error('照片校验失败：' + file.path);
  }
  const written: string[] = [];
  try {
    for (const file of manifest.files) {
      const photo = records.photos.find(p => p.id === file.photoId)!;
      // A deterministic new key prevents archive paths from becoming local filesystem paths.
      photo.object_key = `${photo.owner}/recovered/${photo.id}`;
      const bytes = await readFile(file.path);
      if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) throw new Error('照片在恢复过程中发生变化：' + file.path);
      await adapter.files.put(photo.object_key, bytes, {httpMetadata: {contentType: photo.mime}});
      written.push(photo.object_key);
    }
    const statements = insertStatements(adapter.database, records);
    if (statements.length) await adapter.database.batch(statements);
  } catch (e) {
    await adapter.files.delete(written); throw e;
  }
  return {counts: manifest.counts, bytes: manifest.files.reduce((n, f) => n + f.size, 0)};
}
