import {bindings, bucket, db, HttpError, now, uid} from './server';
import {acquireMaintenance, audit, releaseMaintenance, renewMaintenance} from './maintenance';
import {canonical, EXCLUDED, FORMAT, insertStatements, keyColumn, METADATA_LIMIT, missingRows, PHOTO_LIMIT, planRestore, readRecords, sha256, TABLES, validatePackage, validateRecords, VERSION, type Manifest, type Records} from './backup-format';
import {credentialReady, modelSchema} from './model-config';
import {validImage} from './prompts';

const snapshotKey = (id: string) => `__admin_operations/${id}/snapshot.json`;
const stagedKey = (id: string, photo: Record<string, any>) => `${photo.owner}/restore-${id}/${photo.id}`;
type Snapshot = {manifest: Manifest; records: Records; missing?: Records};
async function saveSnapshot(id: string, data: Snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > METADATA_LIMIT) throw new HttpError('备份清单超过 16 MB，请使用离线工具分批处理。', 413);
  await bucket().put(snapshotKey(id), bytes, {httpMetadata: {contentType: 'application/json'}});
}
async function readSnapshot(id: string): Promise<Snapshot> {
  const value = await bucket().get(snapshotKey(id));
  if (!value) throw new HttpError('操作记录已清理，请重新开始', 410);
  return JSON.parse(new TextDecoder().decode(await value.arrayBuffer()));
}
async function operation(id: string, owner: string, kind?: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError('操作不存在', 404);
  const row = await db().prepare('SELECT * FROM admin_operations WHERE id=? AND owner=?').bind(id, owner).first();
  if (!row || (kind && row.kind !== kind)) throw new HttpError('操作不存在', 404);
  return row;
}
async function active(id: string, owner: string, kind?: string) {
  const row = await operation(id, owner, kind);
  if (row.status !== 'active') throw new HttpError('这次操作已经结束，请重新开始', 409);
  await renewMaintenance(id, owner);
  return row;
}
async function cleanStaging(id: string, snapshot: Snapshot) {
  if (!snapshot.missing) return;
  for (const photo of snapshot.missing.photos) {
    // If a commit completed but its HTTP response was lost, retain referenced files.
    const key = stagedKey(id, photo);
    if (!await db().prepare('SELECT id FROM photos WHERE object_key=?').bind(key).first()) await bucket().delete(key);
  }
}
export async function cleanupExpired() {
  const rows = await db().prepare("SELECT * FROM admin_operations WHERE status IN ('active','committing') AND expires<=? LIMIT 5").bind(now()).all();
  for (const row of rows.results) {
    const claimed = await db().prepare("UPDATE admin_operations SET status='expired' WHERE id=? AND status IN ('active','committing') AND expires<=? RETURNING id").bind(row.id, now()).first();
    if (!claimed) continue;
    const object = await bucket().get(snapshotKey(row.id));
    if (object) await cleanStaging(row.id, JSON.parse(new TextDecoder().decode(await object.arrayBuffer())));
    await bucket().delete(snapshotKey(row.id));
    await releaseMaintenance(row.id);
  }
}
async function begin(owner: string, kind: 'backup' | 'restore', prepare: () => Promise<Snapshot>) {
  await cleanupExpired();
  const id = uid();
  await acquireMaintenance(id, owner);
  try {
    const snapshot = await prepare();
    await saveSnapshot(id, snapshot);
    await db().prepare('INSERT INTO admin_operations(id,owner,kind,status,created,expires) VALUES(?,?,?,?,?,?)')
      .bind(id, owner, kind, 'active', now(), now() + 10 * 60_000).run();
    return {id, ...snapshot};
  } catch (e) {
    await bucket().delete(snapshotKey(id)); await releaseMaintenance(id); throw e;
  }
}
export async function beginBackup(owner: string) {
  return begin(owner, 'backup', async () => {
    const records = validateRecords(await readRecords(db()));
    const manifest: Manifest = {format: FORMAT, version: VERSION, schemaVersion: 3, created: now(), recordsSha256: await sha256(canonical(records)),
      counts: Object.fromEntries(TABLES.map(t => [t, records[t].length])), excluded: [...EXCLUDED],
      files: records.photos.map((p, i) => ({photoId: p.id, path: `files/${i}.bin`, size: p.size, sha256: '0'.repeat(64)}))};
    return {manifest, records};
  });
}
export async function backupFile(id: string, owner: string, photoId: string) {
  await active(id, owner, 'backup');
  const snapshot = await readSnapshot(id), photo = snapshot.records.photos.find(p => p.id === photoId);
  if (!photo) throw new HttpError('照片不在这次备份中', 404);
  const object = await bucket().get(photo.object_key);
  if (!object || object.size !== photo.size) throw new HttpError('原文件缺失或大小不一致，已停止生成不完整备份。', 409);
  return new Response(object.body as BodyInit, {headers: {'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
}
export async function finishBackup(id: string, owner: string) {
  await active(id, owner, 'backup');
  const {manifest} = await readSnapshot(id);
  await audit(owner, 'backup.downloaded', {operation: id, counts: manifest.counts});
  await db().prepare("UPDATE admin_operations SET status='complete' WHERE id=?").bind(id).run();
  await bucket().delete(snapshotKey(id)); await releaseMaintenance(id);
  return {ok: true};
}
async function previewValidated(data: Snapshot, current: Records, checkFiles = true) {
  const plan = planRestore(data.records, current);
  // An archive cannot overwrite another account's credits or current settings.
  const missing = missingRows(data.records, current);
  for (const setting of missing.site_settings) {
    if (!credentialReady(modelSchema.parse(JSON.parse(setting.value)), bindings())) plan.conflicts.push({table: 'site_settings', id: setting.id, reason: '目标环境未配置此模型的服务密钥'});
  }
  if (plan.totalAdd > 500) plan.conflicts.push({table: 'backup', id: 'size', reason: '新增记录超过网页版单次恢复上限 500 条，请在空白服务器使用离线恢复工具'});
  if (checkFiles && !plan.conflicts.length) {
    const existing = new Map(current.photos.map(p => [p.id, p]));
    for (const file of data.manifest.files) {
      const photo = existing.get(file.photoId);
      if (!photo) continue;
      const object = await bucket().get(photo.object_key);
      if (!object || object.size !== file.size || await sha256(await object.arrayBuffer()) !== file.sha256) {
        plan.conflicts.push({table: 'photos', id: photo.id, reason: '现有原文件与备份不一致，请使用离线完整恢复'});
        if (plan.conflicts.length >= 100) break;
      }
    }
  }
  return {plan, missing};
}
export async function previewRestore(input: unknown) {
  const {manifest, records} = input as Snapshot;
  const data = await validatePackage(manifest, records);
  return (await previewValidated(data, await readRecords(db()))).plan;
}
export async function beginRestore(owner: string, input: unknown) {
  const {manifest, records} = input as Snapshot;
  const data = await validatePackage(manifest, records);
  const result = await begin(owner, 'restore', async () => {
    const {plan, missing} = await previewValidated(data, await readRecords(db()));
    if (plan.conflicts.length) throw new HttpError('备份与现有数据冲突，请先查看校验结果；没有修改现有内容。', 409);
    return {...data, missing};
  });
  return {id: result.id, photoIds: result.missing!.photos.map(p => p.id)};
}
export async function restoreFile(id: string, owner: string, photoId: string, bytes: Uint8Array) {
  await active(id, owner, 'restore');
  const snapshot = await readSnapshot(id), photo = snapshot.missing?.photos.find(p => p.id === photoId);
  const file = snapshot.manifest.files.find(p => p.photoId === photoId);
  if (!photo || !file) throw new HttpError('照片不在本次待恢复清单中');
  if (bytes.length > PHOTO_LIMIT || bytes.length !== file.size || await sha256(bytes) !== file.sha256 || !validImage(bytes, photo.mime)) throw new HttpError('照片文件校验失败，未保存', 400);
  await bucket().put(stagedKey(id, photo), bytes, {httpMetadata: {contentType: photo.mime}, customMetadata: {restoredFrom: id}});
  const after = await operation(id, owner, 'restore');
  if (['cancelled', 'expired'].includes(after.status)) {
    const key = stagedKey(id, photo);
    if (!await db().prepare('SELECT id FROM photos WHERE object_key=?').bind(key).first()) await bucket().delete(key);
    throw new HttpError('恢复已经取消或过期，未保存作品记录', 409);
  }
  return {ok: true};
}
export async function commitRestore(id: string, owner: string, confirm: string) {
  if (confirm !== '仅恢复缺失数据') throw new HttpError('请输入“仅恢复缺失数据”确认');
  const state = await operation(id, owner, 'restore');
  if (state.status === 'complete') return {ok: true, alreadyComplete: true};
  await active(id, owner, 'restore');
  const claimed = await db().prepare("UPDATE admin_operations SET status='committing' WHERE id=? AND owner=? AND status='active' RETURNING id").bind(id, owner).first();
  if (!claimed) throw new HttpError('恢复正在提交或已经取消，请稍后刷新。', 409);
  try {
  const snapshot = await readSnapshot(id), current = await readRecords(db());
  const {plan, missing} = await previewValidated(snapshot, current);
  if (plan.conflicts.length) throw new HttpError('恢复前检查发现冲突，已停止。', 409);
  for (const photo of missing.photos) {
    const key = stagedKey(id, photo), file = snapshot.manifest.files.find(f => f.photoId === photo.id)!;
    const object = await bucket().get(key);
    if (!object || object.size !== file.size || await sha256(await object.arrayBuffer()) !== file.sha256) throw new HttpError('还有照片未上传成功或校验失败，未写入任何作品记录。', 409);
    photo.object_key = key;
  }
  // Renew immediately before the transaction, then write records and completion together.
  await renewMaintenance(id, owner);
  await db().batch([...insertStatements(db(), missing),
    db().prepare('INSERT INTO admin_audit(id,actor,action,detail,created) VALUES(?,?,?,?,?)').bind(uid(), owner, 'restore.complete', JSON.stringify({operation: id, added: plan.add, skipped: plan.skip}), now()),
    db().prepare("UPDATE admin_operations SET status='complete' WHERE id=?").bind(id),
  ]);
  await bucket().delete(snapshotKey(id)); await releaseMaintenance(id);
  return {ok: true, added: plan.totalAdd, skipped: plan.totalSkip};
  } catch (e) {
    await db().prepare("UPDATE admin_operations SET status='active' WHERE id=? AND status='committing'").bind(id).run();
    throw e;
  }
}
export async function cancelOperation(id: string, owner: string) {
  const op = await operation(id, owner);
  if (op.status === 'complete') {await releaseMaintenance(id); return {ok: true};}
  const claim = await db().prepare("UPDATE admin_operations SET status='cancelled' WHERE id=? AND status IN ('active','expired','cancelled') RETURNING id").bind(id).first();
  if (!claim) throw new HttpError('恢复结果正在保存，请等待完成后刷新，不要重复取消。', 409);
  const object = await bucket().get(snapshotKey(id));
  if (object) await cleanStaging(id, JSON.parse(new TextDecoder().decode(await object.arrayBuffer())));
  await bucket().delete(snapshotKey(id)); await releaseMaintenance(id);
  return {ok: true};
}
export async function operationHeartbeat(id: string, owner: string) {
  const op = await operation(id, owner);
  if (!['active', 'committing'].includes(op.status)) throw new HttpError('这次操作已经结束', 409);
  await renewMaintenance(id, owner); return {ok: true};
}
export async function administrationStatus() {
  const counts: Record<string, number> = {};
  for (const table of TABLES) counts[table] = Number((await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())!.n);
  const bytes = Number((await db().prepare('SELECT COALESCE(SUM(size),0) AS n FROM photos').first())!.n);
  const maintenance = await db().prepare('SELECT operation,expires FROM maintenance_lock WHERE expires>?').bind(now()).first();
  const history = (await db().prepare('SELECT action,detail,created FROM admin_audit ORDER BY created DESC LIMIT 12').all()).results;
  return {counts, bytes, maintenance, history};
}
