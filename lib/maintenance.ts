import {db, HttpError, json, now, uid} from './server';

const LEASE_MS = 10 * 60_000;
export async function audit(actor: string, action: string, detail: unknown) {
  await db().prepare('INSERT INTO admin_audit(id,actor,action,detail,created) VALUES(?,?,?,?,?)')
    .bind(uid(), actor, action, JSON.stringify(detail), now()).run();
}
export async function withWriteLease<T>(fn: () => Promise<T>): Promise<T> {
  const id = uid(), time = now();
  await db().prepare('DELETE FROM write_leases WHERE expires<=?').bind(time).run();
  const acquired = await db().prepare('INSERT INTO write_leases(id,expires) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM maintenance_lock WHERE expires>?) RETURNING id')
    .bind(id, time + LEASE_MS, time).first();
  if (!acquired) throw new HttpError('网站所有者正在备份或恢复，请稍后重试。你的作品和额度不会受影响。', 503);
  try { return await fn(); }
  finally { await db().prepare('DELETE FROM write_leases WHERE id=?').bind(id).run(); }
}
// GET /state recovers abandoned jobs, and GET /orders may settle a payment.
export function withMaintenance<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    const mutates = request.method !== 'GET' || /\/api\/v1\/(state|orders)(\/|$)/.test(new URL(request.url).pathname);
    if (!mutates) return handler(request, context);
    try { return await withWriteLease(() => handler(request, context)); }
    catch (e) { return json({error: e instanceof HttpError ? e.message : '服务暂时不可用'}, e instanceof HttpError ? e.status : 500); }
  };
}
export async function acquireMaintenance(operation: string, owner: string) {
  const time = now();
  const row = await db().prepare(`INSERT INTO maintenance_lock(id,operation,owner,expires)
    SELECT 'site',?,?,? WHERE NOT EXISTS(SELECT 1 FROM write_leases WHERE expires>?)
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE status='running')
    ON CONFLICT(id) DO UPDATE SET operation=excluded.operation,owner=excluded.owner,expires=excluded.expires
    WHERE maintenance_lock.expires<=? RETURNING operation`)
    .bind(operation, owner, time + LEASE_MS, time, time).first();
  if (!row) throw new HttpError('有正在处理的操作，或另一个备份尚未结束。请稍后重试。', 409);
}
export async function renewMaintenance(operation: string, owner: string) {
  const time = now();
  const row = await db().prepare('UPDATE maintenance_lock SET expires=? WHERE id=? AND operation=? AND owner=? AND expires>? RETURNING operation')
    .bind(time + LEASE_MS, 'site', operation, owner, time).first();
  if (!row) throw new HttpError('操作已过期，请重新开始；现有数据未被覆盖。', 409);
  await db().prepare('UPDATE admin_operations SET expires=? WHERE id=?').bind(time + LEASE_MS, operation).run();
}
export async function releaseMaintenance(operation: string) {
  await db().prepare('DELETE FROM maintenance_lock WHERE operation=?').bind(operation).run();
}
