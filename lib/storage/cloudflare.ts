import type {Database, FileStore, StorageAdapter} from './contracts';

export function cloudflareStorage(bindings: Record<string, any>): StorageAdapter {
  if (!bindings.DB || !bindings.BUCKET) throw new Error('Storage bindings are unavailable');
  // D1's batch is transactional; R2 streams original bytes without changing keys.
  return {database: bindings.DB as Database, files: bindings.BUCKET as FileStore, name: 'Cloudflare D1 + R2'};
}
