import {cloudflareStorage} from './cloudflare';
import type {StorageAdapter} from './contracts';

let replacement: StorageAdapter | undefined;
// Trusted server bootstrap only. Never select a storage destination from an HTTP request.
export function configureStorage(adapter: StorageAdapter) { replacement = adapter; }
export function storage(bindings: Record<string, any>) { return replacement || cloudflareStorage(bindings); }
