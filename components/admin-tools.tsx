'use client';
import {useEffect, useRef, useState} from 'react';
import {DatabaseBackup, Download, FolderOpen, RefreshCw, ShieldCheck, SlidersHorizontal} from 'lucide-react';
import {adminCall, downloadBackup, readBackupFolder, readBackupZip, verifyArchive, type LoadedBackup} from '@/lib/backup-browser';
import {TABLES, type RestorePlan} from '@/lib/backup-format';
import type {ModelConfig} from '@/lib/model-config';

const names: Record<string, string> = {users: '用户及额度', email_accounts: '邮箱账号', account_reviews: '审核记录', photos: '照片原文件', albums: '相册', jobs: '创作记录', comments: '评论', likes: '点赞', ratings: '评分', orders: '订单', site_settings: '模型设置', admin_audit: '管理记录'};
const sizeLabel = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(2)} MB`;
export default function AdminTools() {
  const [status, setStatus] = useState<any>(null), [settings, setSettings] = useState<any>(null), [config, setConfig] = useState<ModelConfig | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [progress, setProgress] = useState('');
  const [archive, setArchive] = useState<LoadedBackup | null>(null), [plan, setPlan] = useState<RestorePlan | null>(null), [confirm, setConfirm] = useState(''), [modelConfirm, setModelConfirm] = useState(false);
  const [folderSupported, setFolderSupported] = useState(false), [operation, setOperation] = useState<string | null>(null);
  const cancelled = useRef(false), uploading = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const [s, m] = await Promise.all([adminCall('status'), adminCall('model')]);
    setStatus(s); setSettings(m); setConfig(m.config); setModelConfirm(false);
  }
  useEffect(() => {setFolderSupported('showDirectoryPicker' in window); refresh().catch(e => setMessage(e.message));}, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {e.preventDefault();};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function run(work: () => Promise<void>) {
    if (uploading.current) return; uploading.current = true; cancelled.current = false;
    setBusy(true); setMessage(''); setProgress('正在处理…');
    try {await work();} catch (e: any) {if (e.name !== 'AbortError') setMessage(e.message || '操作未完成');}
    finally {setBusy(false); setProgress(''); uploading.current = false;}
  }
  async function backup(folder?: any) {
    await run(async () => {
      const result = await downloadBackup({folder, progress: setProgress, cancelled: () => cancelled.current, operation: setOperation});
      setMessage(`完整备份已${folder ? '保存到所选文件夹' : '交给浏览器下载'}：${result.photos} 张照片，${sizeLabel(result.bytes)}。请保存在自己的安全位置，并用下方校验检查文件。`);
      await refresh();
    });
  }
  async function loadArchive(load: () => Promise<LoadedBackup>) {
    await run(async () => {
      setArchive(null); setPlan(null); setConfirm('');
      const next = await load();
      await verifyArchive(next, setProgress, () => cancelled.current);
      setProgress('原文件校验通过，正在与网站现有数据比较…');
      const preview = await adminCall('restore/preview', 'POST', {manifest: next.manifest, records: next.records});
      setArchive(next); setPlan(preview);
      setMessage(preview.conflicts.length ? '文件校验完成，但发现数据冲突。现有数据未被修改，恢复已禁用。' : preview.totalAdd ? '校验通过。请核对下方将补回的内容，再决定是否恢复。' : '校验通过。所有备份记录和照片均已存在，无需恢复；网站数据未被修改。');
    });
  }
  async function restore() {
    if (!archive || !plan || plan.conflicts.length || !plan.totalAdd) return;
    await run(async () => {
      let id: string | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, heartbeatError = '';
      try {
        const start = await adminCall('restore/start', 'POST', {manifest: archive.manifest, records: archive.records}); id = start.id; setOperation(id!);
        heartbeat = setInterval(() => {adminCall(`operations/${id}/heartbeat`, 'POST', {}).catch(e => {heartbeatError = e.message;});}, 30_000);
        let index = 0;
        for (const photoId of start.photoIds) {
          if (cancelled.current) throw new Error('已取消恢复，现有数据未修改。');
          if (heartbeatError) throw new Error(heartbeatError);
          setProgress(`正在校验并暂存照片 ${++index} / ${start.photoIds.length}`);
          const file = archive.manifest.files.find(f => f.photoId === photoId)!;
          await adminCall(`restore/${id}/file/${encodeURIComponent(photoId)}`, 'PUT', await archive.readPhoto(file.path), true);
        }
        if (cancelled.current) throw new Error('已取消恢复，现有数据未修改。');
        if (heartbeatError) throw new Error(heartbeatError);
        setProgress('正在一次性保存恢复结果，请不要关闭页面…');
        const result = await adminCall(`restore/${id}/commit`, 'POST', {confirm}); id = undefined;
        setArchive(null); setPlan(null); setConfirm(''); await refresh();
        setMessage(`恢复完成，补回 ${result.added || 0} 条记录。原有数据和额度未被覆盖。`);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (id) await adminCall(`operations/${id}`, 'DELETE').catch(() => {});
        setOperation(null);
      }
    });
  }
  const changed = settings && config && JSON.stringify(settings.config) !== JSON.stringify(config);
  return <section className="panel account-admin admin-tools" aria-label="数据备份与模型管理">
    <div className="account-admin-heading"><div><span className="eyebrow">KEEP YOUR MEMORIES SAFE</span><h2>数据备份与模型管理</h2></div><button className="button small" disabled={busy} onClick={() => run(refresh)}><RefreshCw size={15}/> 刷新管理状态</button></div>
    <p className="body-copy">仅网站所有者可见。当前存储仍为 Cloudflare D1／R2，公开网站地址保持不变。</p>
    {status && <div className="admin-stats"><span><strong>{status.counts.users}</strong> 个用户</span><span><strong>{status.counts.photos}</strong> 张照片</span><span><strong>{status.counts.albums}</strong> 本相册</span><span><strong>{sizeLabel(status.bytes)}</strong> 照片原文件</span></div>}
    {status?.maintenance && !busy && <div className="account-note">当前有备份或恢复未结束，写入暂时暂停。关闭原页面时可能需要等待自动释放。<button className="text-button" onClick={() => run(async () => {await adminCall(`operations/${status.maintenance.operation}`, 'DELETE'); await refresh(); setMessage('未完成的操作已结束，写入已恢复。');})}>结束我的未完成操作</button></div>}
    <div className="admin-tool-section"><h3><DatabaseBackup size={20}/> 完整备份</h3><p className="body-copy">保存全部用户、审批与额度、原图和 AI 图片、相册顺序、分享设置、互动、订单及模型参数。验证码、登录会话和服务器密钥不包含在备份中；恢复到新服务器后需重新配置密钥并登录。</p>
      <div className="account-actions"><button className="button primary" disabled={busy || !status} onClick={() => backup()}><Download size={16}/> 下载完整备份 ZIP</button>{folderSupported && <button className="button" disabled={busy || !status} onClick={async () => {try {const folder = await (window as any).showDirectoryPicker({mode: 'readwrite'}); await backup(folder);} catch (e: any) {if (e.name !== 'AbortError') setMessage(e.message);}}}><FolderOpen size={16}/> 备份到文件夹</button>}</div>
      <p className="footnote">备份期间暂时暂停上传、AI 创作和账号审核，浏览已有分享不受影响。ZIP 上限 256 MB；较多照片请在支持文件夹选择的电脑浏览器中逐张备份。记录清单上限 16 MB／10 万条，超限会明确停止，不会悄悄漏掉内容。备份含私人资料，请勿上传到公开 GitHub 仓库。</p>
    </div>
    <div className="admin-tool-section"><h3><ShieldCheck size={20}/> 校验与恢复</h3><p className="body-copy">先检查所有照片的校验值，再预览将恢复的内容。这里只补回缺失记录：相同记录跳过，有冲突就停止，不覆盖已有用户、作品和额度。</p>
      <div className="account-actions"><input ref={fileInput} type="file" accept=".zip,application/zip" aria-label="选择完整备份 ZIP" disabled={busy} onChange={e => {const file = e.target.files?.[0]; if (file) loadArchive(() => readBackupZip(file)); e.target.value = '';}}/>{folderSupported && <button className="button small" disabled={busy} onClick={async () => {try {const folder = await (window as any).showDirectoryPicker({mode: 'read'}); await loadArchive(() => readBackupFolder(folder));} catch (e: any) {if (e.name !== 'AbortError') setMessage(e.message);}}}>选择备份文件夹</button>}</div>
      {archive && plan && <div className="restore-preview"><p>备份时间：{new Date(archive.manifest.created).toLocaleString('zh-CN')} · 待补回 {plan.totalAdd} 条 · 已存在 {plan.totalSkip} 条</p><div className="admin-table-scroll"><table><thead><tr><th>内容</th><th>待补回</th><th>相同记录</th></tr></thead><tbody>{TABLES.map(t => <tr key={t}><td>{names[t]}</td><td>{plan.add[t]}</td><td>{plan.skip[t]}</td></tr>)}</tbody></table></div>
        {plan.conflicts.length > 0 ? <div className="account-note" role="alert"><strong>发现 {plan.conflicts.length} 项冲突，恢复已禁用</strong><ul>{plan.conflicts.slice(0, 10).map((v, i) => <li key={i}>{names[v.table] || v.table}：{v.reason}（{v.id.slice(0, 16)}）</li>)}</ul></div> : plan.totalAdd > 0 ? <><label className="field"><span>确认无误后，输入“仅恢复缺失数据”</span><input disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off"/></label><button className="button primary" disabled={busy || confirm !== '仅恢复缺失数据'} onClick={restore}>确认补回缺失数据</button></> : <p className="account-note">全部内容已存在，无需恢复。此次仅校验，没有改动网站数据。</p>}
      </div>}
      <p className="footnote">网页版单次最多补回 500 条记录。完整迁移或灾难恢复可用仓库内的离线工具，向全新的 SQLite 数据库与照片目录恢复；工具拒绝覆盖非空目标。</p>
    </div>
    <div className="admin-tool-section"><h3><SlidersHorizontal size={20}/> AI 模型设置</h3>{settings && config ? <>
      <p className="body-copy">当前生效：{settings.config.provider === 'openai' ? 'OpenAI' : '火山方舟'} / <strong>{settings.config.model}</strong> · {settings.ready ? '服务器密钥已配置' : '尚未配置密钥'}。只有点击保存后才会改变后续创作，历史照片与额度不变。</p>
      <div className="admin-config-grid"><label className="field"><span>图像服务</span><select disabled={busy} value={config.provider} onChange={e => {setConfig(e.target.value === 'openai' ? {provider: 'openai', model: 'gpt-image-2', size: '1536x1024', quality: 'medium'} : {provider: 'ark', model: 'doubao-seedream-4-5-251128', size: '2K', quality: 'standard'}); setModelConfirm(false);}}><option value="openai">OpenAI · {settings.credentials.openai ? '密钥已配置' : '未配置'}</option><option value="ark">火山方舟 · {settings.credentials.ark ? '密钥已配置' : '未配置'}</option></select></label>
        <label className="field"><span>模型名称或接入点 ID</span><input disabled={busy} maxLength={120} value={config.model} onChange={e => {setConfig({...config, model: e.target.value}); setModelConfirm(false);}}/></label>
        <label className="field"><span>输出尺寸</span><select disabled={busy} value={config.size} onChange={e => {setConfig({...config, size: e.target.value} as ModelConfig); setModelConfirm(false);}}>{(config.provider === 'openai' ? ['1536x1024', '1024x1024', '1024x1536', 'auto'] : ['2K', '4K']).map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="field"><span>生成质量</span><select disabled={busy || config.provider === 'ark'} value={config.quality} onChange={e => {setConfig({...config, quality: e.target.value} as ModelConfig); setModelConfirm(false);}}>{(config.provider === 'openai' ? ['low', 'medium', 'high', 'auto'] : ['standard']).map(q => <option key={q} value={q}>{({low: '低', medium: '中', high: '高', auto: '自动', standard: '标准'} as any)[q]}</option>)}</select></label></div>
      {changed && <label className="admin-check"><input type="checkbox" checked={modelConfirm} onChange={e => setModelConfirm(e.target.checked)}/> 我已确认该模型支持参考图编辑；新配置的效果、速度和费用可能不同。</label>}
      <div className="account-actions"><button className="button primary" disabled={busy || !changed || !modelConfirm || !settings.credentials[config.provider]} onClick={() => run(async () => {const result = await adminCall('model', 'PUT', {config, revision: settings.revision}); setSettings(result); setConfig(result.config); setModelConfirm(false); setMessage('模型设置已保存，将用于下一次创作。此次保存没有调用模型或扣除额度。');})}>保存模型设置</button><button className="button" disabled={busy || !changed} onClick={() => {setConfig(settings.config); setModelConfirm(false);}}>撤销未保存修改</button></div>
      <p className="footnote">密钥只在服务器环境配置，本页不会读取或显示明文密钥。保存会检查参数格式与密钥是否配置，不代表模型已通过真实出图测试；首次启用新模型后应试生成一张。新的 API 协议需增加服务适配器。</p>
    </> : <p className="body-copy">正在读取模型设置…</p>}</div>
    {busy && <div role="status" className="account-message">{progress}{(operation || progress.includes('检查照片')) && !progress.includes('一次性保存') && <button className="text-button" onClick={() => {cancelled.current = true; setProgress('正在安全结束当前操作…');}}>取消</button>}</div>}
    {message && <p className="account-message" role="status">{message}</p>}
    {status?.history?.length > 0 && <details className="admin-history"><summary>最近的管理记录</summary>{status.history.map((item: any, i: number) => <p key={i}>{new Date(item.created).toLocaleString('zh-CN')} · {({'backup.downloaded': '已生成完整备份', 'restore.complete': '已恢复缺失数据', 'model.updated': '已保存模型配置'} as any)[item.action] || item.action}</p>)}</details>}
  </section>;
}
