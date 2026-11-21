// Reference adapter for a future Node server and the isolated disaster-recovery tool.
// No cloud credentials and no runtime dependency on Cloudflare are required.
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile, lstat} from 'node:fs/promises';
import path from 'node:path';

export async function createLocalStorage(root) {
  const directory = path.resolve(root);
  await mkdir(directory, {recursive: true});
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Restore directory must not be a symlink');
  const filesPath = path.join(directory, 'objects');
  await mkdir(filesPath, {recursive: true});
  if ((await lstat(filesPath)).isSymbolicLink()) throw new Error('Object directory must not be a symlink');
  const connection = new DatabaseSync(path.join(directory, 'database.sqlite'));
  connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _file_objects(key TEXT PRIMARY KEY,path TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT,custom TEXT)');
  const result = (results = [], changes = 0) => ({results, success: true, meta: {changes}});
  const database = {
    prepare(sql) {
      const execute = (mode, values) => {
        const query = connection.prepare(sql);
        if (mode === 'all') return result(query.all(...values));
        if (mode === 'first') return query.get(...values) || null;
        const value = query.run(...values); return result([], Number(value.changes));
      };
      const statement = values => ({
        bind(...next) {return statement(next);},
        async first(column) {const value = execute('first', values); return column ? value?.[column] ?? null : value;},
        async all() {return execute('all', values);},
        async run() {return execute('run', values);},
        _execute() {return execute('run', values);},
      });
      return statement([]);
    },
    async batch(statements) {
      connection.exec('BEGIN IMMEDIATE');
      try {const results = statements.map(s => s._execute()); connection.exec('COMMIT'); return results;}
      catch (e) {connection.exec('ROLLBACK'); throw e;}
    },
  };
  const files = {
    async put(key, value, options = {}) {
      const name = createHash('sha256').update(key).digest('hex') + '.bin';
      const dest = path.join(filesPath, name), temp = dest + '.' + randomUUID() + '.tmp';
      const bytes = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : new Uint8Array(value);
      try {
        await writeFile(temp, bytes, {flag: 'wx'}); await rename(temp, dest);
        connection.prepare('INSERT INTO _file_objects(key,path,size,mime,custom) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET path=excluded.path,size=excluded.size,mime=excluded.mime,custom=excluded.custom')
          .run(key, name, bytes.length, options.httpMetadata?.contentType || 'application/octet-stream', JSON.stringify(options.customMetadata || {}));
      } finally {await unlink(temp).catch(e => {if (e.code !== 'ENOENT') throw e;});}
    },
    async get(key) {
      const row = connection.prepare('SELECT * FROM _file_objects WHERE key=?').get(key);
      if (!row) return null;
      const bytes = new Uint8Array(await readFile(path.join(filesPath, row.path)));
      return {size: bytes.length, body: bytes, httpMetadata: {contentType: row.mime}, async arrayBuffer() {return bytes.slice().buffer;}};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        const row = connection.prepare('SELECT path FROM _file_objects WHERE key=?').get(key);
        if (!row) continue;
        await unlink(path.join(filesPath, row.path)).catch(e => {if (e.code !== 'ENOENT') throw e;});
        connection.prepare('DELETE FROM _file_objects WHERE key=?').run(key);
      }
    },
    async list({prefix = '', cursor = '', limit = 1000} = {}) {
      const count = Math.max(1, Math.min(1000, limit));
      const rows = connection.prepare('SELECT key,size FROM _file_objects WHERE substr(key,1,?)=? AND key>? ORDER BY key LIMIT ?').all(prefix.length, prefix, cursor, count + 1);
      const truncated = rows.length > count, objects = rows.slice(0, count);
      return {objects, truncated, cursor: truncated ? objects.at(-1).key : undefined};
    },
  };
  return {name: 'SQLite + local files', database, files, connection, close() {connection.close();}};
}
