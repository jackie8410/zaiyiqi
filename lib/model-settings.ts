import {bindings, db, HttpError, now, uid} from './server';
import {credentialReady, defaultModel, modelSchema, type ModelConfig} from './model-config';

export async function modelSettings() {
  const row = await db().prepare('SELECT * FROM site_settings WHERE id=?').bind('image_model').first();
  const config = row ? modelSchema.parse(JSON.parse(row.value)) : defaultModel(bindings());
  return {config, revision: row?.revision || 0, source: row ? 'admin' : 'environment', ready: credentialReady(config, bindings())};
}
export async function publicModelSettings() {
  return {...await modelSettings(), credentials: {openai: !!bindings().OPENAI_API_KEY, ark: !!bindings().ARK_API_KEY}};
}
export async function saveModelSettings(actor: string, input: {config: ModelConfig; revision: number}) {
  const parsed = modelSchema.safeParse(input.config);
  if (!parsed.success || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new HttpError('模型配置格式不正确');
  if (!credentialReady(parsed.data, bindings())) throw new HttpError('这个服务尚未配置服务器密钥，请先在托管环境中接入，再启用。');
  const revision = input.revision + 1, time = now();
  const result = await db().batch([
    db().prepare(`INSERT INTO site_settings(id,value,revision,updated,actor) SELECT 'image_model',?,?,?,?
      WHERE ?=0 OR EXISTS(SELECT 1 FROM site_settings WHERE id='image_model')
      ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated=excluded.updated,actor=excluded.actor
      WHERE site_settings.revision=excluded.revision-1`).bind(JSON.stringify(parsed.data), revision, time, actor, input.revision),
    db().prepare('INSERT INTO admin_audit(id,actor,action,detail,created) SELECT ?,?,?,?,? WHERE changes()=1')
      .bind(uid(), actor, 'model.updated', JSON.stringify({config: parsed.data, revision}), time),
  ]);
  if (!result[0].meta.changes) throw new HttpError('配置已被另一页面修改，请刷新后再保存。', 409);
  return publicModelSettings();
}
