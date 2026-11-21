import {z} from 'zod';
import type {Database, Row} from './storage/contracts';
import {modelSchema} from './model-config';

export const FORMAT = 'zaiyiqi-full-backup';
export const VERSION = 1;
export const METADATA_LIMIT = 16 * 1024 * 1024;
export const ZIP_LIMIT = 256 * 1024 * 1024;
export const PHOTO_LIMIT = 25 * 1024 * 1024;
const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:.@+-]+$/);
const str = z.string().max(10000), short = z.string().max(500), integer = z.number().int().safe(), time = integer.nonnegative();
const jsonText = z.string().max(512000).refine(v => {try {JSON.parse(v); return true;} catch {return false;}}, 'JSON 内容损坏');
const status = z.enum(['pending', 'approved', 'rejected', 'suspended']);
export const rowSchemas = {
  users: z.object({id, name: short, credits: integer.nonnegative(), pro_until: time, created: time}).strict(),
  email_accounts: z.object({user_id: id, email: z.string().email().max(254), status, application: short, review_note: short,
    verified_at: time, reviewed_at: time.nullable(), reviewed_by: id.nullable(), created: time}).strict(),
  account_reviews: z.object({id, user_id: id, actor_id: id, previous_status: status, status, note: short, created: time}).strict(),
  photos: z.object({id, owner: id, object_key: z.string().min(1).max(1024), name: short,
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), size: integer.positive().max(PHOTO_LIMIT), kind: z.enum(['original', 'ai']), created: time}).strict(),
  albums: z.object({id, owner: id, title: short, subtitle: short, theme: short, mode: short, pages: jsonText,
    visibility: z.enum(['private', 'unlisted', 'public']), share_token: short.nullable(), password_hash: short.nullable(),
    revision: integer.positive(), created: time, updated: time}).strict(),
  jobs: z.object({id, owner: id, kind: short, config: jsonText, sources: jsonText, results: jsonText, attempts: integer.nonnegative(),
    status: z.enum(['ready', 'complete', 'failed']), charged: integer.min(0).max(2), error: str.nullable(), created: time, updated: time}).strict(),
  comments: z.object({id, album_id: id, owner: id, name: short, body: str, created: time}).strict(),
  likes: z.object({id, album_id: id, owner: id}).strict(),
  ratings: z.object({id, album_id: id, owner: id, score: integer.min(1).max(5)}).strict(),
  orders: z.object({id, owner: id, product: short, channel: short, amount: integer.nonnegative(), status: short,
    transaction_id: short.nullable(), created: time, paid: time.nullable()}).strict(),
  site_settings: z.object({id: z.literal('image_model'), value: jsonText.refine(v => modelSchema.safeParse(JSON.parse(v)).success),
    revision: integer.positive(), updated: time, actor: id}).strict(),
  admin_audit: z.object({id, actor: id, action: short, detail: jsonText, created: time}).strict(),
};
export type TableName = keyof typeof rowSchemas;
export const TABLES = Object.keys(rowSchemas) as TableName[];
export const keyColumn = (table: TableName) => table === 'email_accounts' ? 'user_id' : 'id';
export type Records = Record<TableName, Row[]>;
export const EXCLUDED = ['account_sessions', 'email_codes', 'share_sessions', 'rate_limits', 'maintenance_lock', 'write_leases', 'admin_operations', 'server_secrets'] as const;
const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const manifestSchema = z.object({
  format: z.literal(FORMAT), version: z.literal(VERSION), schemaVersion: z.literal(3), created: time,
  recordsSha256: sha, counts: z.record(integer.nonnegative()), excluded: z.array(z.string()),
  files: z.array(z.object({photoId: id, path: z.string().regex(/^files\/[0-9]{1,8}\.bin$/), size: integer.positive().max(PHOTO_LIMIT), sha256: sha}).strict()).max(100000),
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Row)[k])).join(',') + '}';
}
export async function sha256(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof ArrayBuffer ? value : value.slice().buffer);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateRecords(input: unknown): Records {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join() !== [...TABLES].sort().join()) throw new Error('备份数据表不完整或版本不受支持');
  const records = {} as Records;
  let total = 0;
  for (const table of TABLES) {
    const rows = (input as Records)[table];
    if (!Array.isArray(rows) || (total += rows.length) > 100000) throw new Error('备份记录过多或格式损坏');
    const seen = new Set();
    records[table] = rows.map(row => {
      const parsed = rowSchemas[table].safeParse(row);
      if (!parsed.success) throw new Error(`备份中的 ${table} 记录格式不正确`);
      const value = parsed.data as Row, key = value[keyColumn(table)];
      if (seen.has(key)) throw new Error(`备份中的 ${table} 存在重复记录`);
      seen.add(key); return value;
    });
  }
  const users = new Set(records.users.map(r => r.id));
  const photos = new Map(records.photos.map(r => [r.id, r]));
  const albums = new Set(records.albums.map(r => r.id));
  for (const table of ['photos', 'albums', 'jobs', 'comments', 'likes', 'ratings', 'orders'] as TableName[]) {
    if (records[table].some(r => !users.has(r.owner))) throw new Error('备份包含没有所属账号的作品或订单');
  }
  if (records.email_accounts.some(r => !users.has(r.user_id))) throw new Error('备份账号与用户记录不一致');
  const emails = records.email_accounts.map(r => r.email.toLowerCase());
  if (new Set(emails).size !== emails.length) throw new Error('备份包含重复邮箱');
  for (const album of records.albums) {
    const pages = JSON.parse(album.pages);
    if (!Array.isArray(pages) || pages.length > 200 || pages.some(p => !p || typeof p.caption !== 'string' || p.caption.length > 120 || photos.get(p.photoId)?.owner !== album.owner)) throw new Error('相册页序或照片归属不完整');
  }
  for (const table of ['comments', 'likes', 'ratings'] as TableName[]) if (records[table].some(r => !albums.has(r.album_id))) throw new Error('互动记录对应的相册缺失');
  for (const job of records.jobs) {
    if (!Array.isArray(JSON.parse(job.sources)) || !Array.isArray(JSON.parse(job.results))) throw new Error('创作记录格式不正确');
  }
  const transactions = records.orders.map(r => r.transaction_id).filter(v => v !== null);
  if (new Set(transactions).size !== transactions.length) throw new Error('备份包含重复支付交易');
  return records;
}
export async function validatePackage(manifestInput: unknown, recordsInput: unknown) {
  const result = manifestSchema.safeParse(manifestInput);
  if (!result.success) throw new Error('备份清单不受支持或已损坏');
  const manifest = result.data, records = validateRecords(recordsInput);
  if (Object.keys(manifest.counts).sort().join() !== [...TABLES].sort().join() || TABLES.some(t => manifest.counts[t] !== records[t].length)) throw new Error('备份记录数量与清单不一致');
  if (manifest.excluded.join() !== EXCLUDED.join()) throw new Error('备份范围与当前版本不兼容');
  if (await sha256(canonical(records)) !== manifest.recordsSha256) throw new Error('备份记录校验失败，文件可能被修改或下载不完整');
  const photos = new Map(records.photos.map(p => [p.id, p]));
  const seen = new Set(), paths = new Set();
  for (const file of manifest.files) {
    if (!photos.has(file.photoId) || photos.get(file.photoId)!.size !== file.size || seen.has(file.photoId) || paths.has(file.path)) throw new Error('照片清单缺失、重复或大小不匹配');
    seen.add(file.photoId); paths.add(file.path);
  }
  if (seen.size !== photos.size) throw new Error('备份未包含全部照片原文件');
  return {manifest, records};
}
export async function readRecords(database: Database): Promise<Records> {
  const records = {} as Records;
  let bytes = 0, count = 0;
  for (const table of TABLES) {
    records[table] = [];
    for (let offset = 0; ; offset += 250) {
      const {results} = await database.prepare(`SELECT * FROM ${table} ORDER BY ${keyColumn(table)} LIMIT 250 OFFSET ?`).bind(offset).all();
      bytes += new TextEncoder().encode(JSON.stringify(results)).byteLength; count += results.length;
      if (bytes > METADATA_LIMIT || count > 100000) throw new Error('记录超过网页版备份上限，未导出不完整备份。请联系维护人员使用数据库导出工具。');
      records[table].push(...results);
      if (results.length < 250) break;
    }
  }
  return records;
}
export type RestorePlan = {add: Record<TableName, number>; skip: Record<TableName, number>; conflicts: {table: string; id: string; reason: string}[]; totalAdd: number; totalSkip: number};
export function planRestore(incoming: Records, current: Records): RestorePlan {
  const plan: RestorePlan = {add: Object.fromEntries(TABLES.map(t => [t, 0])) as Record<TableName, number>, skip: Object.fromEntries(TABLES.map(t => [t, 0])) as Record<TableName, number>, conflicts: [], totalAdd: 0, totalSkip: 0};
  for (const table of TABLES) {
    plan.add[table] = 0; plan.skip[table] = 0;
    const existing = new Map(current[table].map(r => [r[keyColumn(table)], r]));
    for (const row of incoming[table]) {
      const key = row[keyColumn(table)], old = existing.get(key);
      // A previous restore may have safely assigned a new storage key; content is checked separately.
      const compare = (r: Row) => table === 'photos' ? {...r, object_key: ''} : r;
      if (!old) {plan.add[table]++; plan.totalAdd++;}
      else if (canonical(compare(old)) === canonical(compare(row))) {plan.skip[table]++; plan.totalSkip++;}
      else if (plan.conflicts.length < 100) plan.conflicts.push({table, id: key, reason: '现有记录已不同，禁止覆盖'});
      if (table === 'email_accounts' && current[table].some(r => r.email.toLowerCase() === row.email.toLowerCase() && r.user_id !== row.user_id)) plan.conflicts.push({table, id: key, reason: '邮箱已属于另一个账号'});
      if (table === 'orders' && row.transaction_id && current[table].some(r => r.transaction_id === row.transaction_id && r.id !== row.id)) plan.conflicts.push({table, id: key, reason: '支付交易已关联其他订单'});
    }
  }
  return plan;
}
export function missingRows(incoming: Records, current: Records) {
  const result = {} as Records;
  for (const table of TABLES) {
    const ids = new Set(current[table].map(r => r[keyColumn(table)]));
    result[table] = incoming[table].filter(r => !ids.has(r[keyColumn(table)]));
  }
  return result;
}
export function insertStatements(database: Database, records: Records) {
  return TABLES.flatMap(table => records[table].map(row => {
    // Column names come only from validated schema shapes, never from archive SQL.
    const columns = Object.keys(rowSchemas[table].shape);
    return database.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).bind(...columns.map(c => row[c]));
  }));
}
