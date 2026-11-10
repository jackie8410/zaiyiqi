import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const client = moduleURL(transpile(await readFile('lib/client.ts', 'utf8')));
const rawModule = async filename => moduleURL('export default ' + JSON.stringify(await readFile(require.resolve(filename), 'utf8')));
const engine = await rawModule('page-flip/dist/js/page-flip.browser.js');
const license = await rawModule('page-flip/LICENSE');
const source = transpile(await readFile('lib/exports.ts', 'utf8'))
  .replace(/(['"])\.\/client\1/, JSON.stringify(client))
  .replace(/(['"])page-flip\/dist\/js\/page-flip\.browser\.js\?raw\1/, JSON.stringify(engine))
  .replace(/(['"])page-flip\/LICENSE\?raw\1/, JSON.stringify(license));
const { exportOffline } = await import(moduleURL(source));

// Exercise the actual offline-export flow without network traffic or a browser download.
const downloads = [];
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
let fetchMode = 'ok';
let readerMode = 'ok';
const saved = {
  fetch: globalThis.fetch, FileReader: globalThis.FileReader, document: globalThis.document,
  createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  setTimeout: globalThis.setTimeout,
};
const blobs = new Map();
process.on('unhandledRejection', onUnhandled);
globalThis.fetch = async () => {
  if (fetchMode === 'network-error') throw new Error('Simulated network failure');
  return {
    ok: fetchMode !== 'http-error',
    async blob() {
      if (fetchMode === 'body-error') throw new Error('Simulated interrupted photo response');
      return new Blob(['fictional test image bytes'], { type: 'image/jpeg' });
    },
  };
};
globalThis.FileReader = class {
  readAsDataURL(blob) {
    queueMicrotask(() => {
      if (readerMode === 'read-error') return this.onerror?.({ type: 'error' });
      if (readerMode === 'abort') return this.onabort?.({ type: 'abort' });
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }, () => this.onerror?.({ type: 'error' }));
    });
  }
};
URL.createObjectURL = blob => {
  const url = `blob:test-${blobs.size}`;
  blobs.set(url, blob);
  return url;
};
URL.revokeObjectURL = url => blobs.delete(url);
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'a');
    return { click() { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); } };
  },
};
globalThis.setTimeout = (callback, delay, ...args) => {
  const timer = saved.setTimeout(callback, delay, ...args);
  if (delay >= 30000) timer.unref();
  return timer;
};
const album = { id: 'export-test', title: '恢复下载测试', subtitle: '', theme: 'linen', mode: 'book', pages: [{ photoId: 'fictional-photo', caption: '虚构测试素材' }] };
const photos = [{ id: 'fictional-photo', url: 'https://test.invalid/photo.jpg', kind: 'ai' }];
async function settleExport() {
  let deadline;
  try {
    return await Promise.race([
      exportOffline(album, photos, () => {}).then(() => ({ status: 'done' }), error => ({ status: 'rejected', error })),
      new Promise(resolve => { deadline = setTimeout(() => resolve({ status: 'stalled' }), 500); }),
    ]);
  } finally { clearTimeout(deadline); }
}
let cases = 0;
try {
  for (const [fetchFailure, readerFailure, expected] of [
    ['http-error', 'ok', /照片下载失败/],
    ['network-error', 'ok', /network failure/],
    ['body-error', 'ok', /照片传输中断/],
    ['ok', 'read-error', /照片读取失败/],
    ['ok', 'abort', /照片读取已中断/],
  ]) {
    fetchMode = fetchFailure;
    readerMode = readerFailure;
    const result = await settleExport();
    assert.equal(result.status, 'rejected', `${fetchFailure}/${readerFailure} must finish with an error`);
    assert.match(result.error.message, expected);
    assert.equal(downloads.length, 0, 'A failed export must not download an incomplete album');
    assert.equal(unhandled.length, 0, 'A failed image must reject the export, not create an unhandled rejection');
    cases++;
  }
  fetchMode = readerMode = 'ok';
  assert.equal((await settleExport()).status, 'done', 'The same album can be exported again after a failure');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, '恢复下载测试-离线相册.html');
  const html = await downloads[0].blob.text();
  assert.ok(html.includes('data:image/jpeg;base64,'), 'The recovered download includes the photo for offline use');
  assert.ok(html.includes('AI生成合成内容'), 'The recovered download keeps the AI label');
  assert.equal(unhandled.length, 0);
  cases++;
  console.log(`Passed ${cases} offline export failure/recovery cases. No external requests or browser downloads.`);
} finally {
  globalThis.fetch = saved.fetch;
  globalThis.FileReader = saved.FileReader;
  globalThis.document = saved.document;
  URL.createObjectURL = saved.createObjectURL;
  URL.revokeObjectURL = saved.revokeObjectURL;
  globalThis.setTimeout = saved.setTimeout;
  process.removeListener('unhandledRejection', onUnhandled);
}
