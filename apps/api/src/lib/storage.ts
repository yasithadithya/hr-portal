import { createClient } from '@supabase/supabase-js';

import { AppError } from './errors';

/**
 * Private file storage in the tenant's own Supabase project (service-role key, server only).
 * Files are never public: reads go through short-lived signed URLs.
 */
export interface Storage {
  upload(bucket: string, path: string, body: Buffer, contentType: string): Promise<void>;
  signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string>;
  remove(bucket: string, path: string): Promise<void>;
}

export function supabaseStorage(
  supabaseUrl: string | null,
  serviceRoleKey: string | null,
): Storage {
  function client() {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        'File storage is not configured for this workspace',
      );
    }
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
  }
  return {
    async upload(bucket, path, body, contentType) {
      const storage = client();
      let res = await storage.from(bucket).upload(path, body, { contentType, upsert: true });
      if (res.error && /bucket not found/i.test(res.error.message)) {
        const created = await storage.createBucket(bucket, { public: false });
        if (created.error) throw new AppError(502, 'INTERNAL_ERROR', created.error.message);
        res = await storage.from(bucket).upload(path, body, { contentType, upsert: true });
      }
      if (res.error)
        throw new AppError(502, 'INTERNAL_ERROR', `Upload failed: ${res.error.message}`);
    },
    async signedUrl(bucket, path, ttlSeconds) {
      const { data, error } = await client().from(bucket).createSignedUrl(path, ttlSeconds);
      if (error || !data) throw new AppError(502, 'INTERNAL_ERROR', 'Could not sign file URL');
      return data.signedUrl;
    },
    async remove(bucket, path) {
      const { error } = await client().from(bucket).remove([path]);
      if (error) throw new AppError(502, 'INTERNAL_ERROR', `Delete failed: ${error.message}`);
    },
  };
}

/** In-memory storage for tests. */
export function memoryStorage(): Storage & { files: Map<string, { body: Buffer; type: string }> } {
  const files = new Map<string, { body: Buffer; type: string }>();
  return {
    files,
    async upload(bucket, path, body, type) {
      files.set(`${bucket}/${path}`, { body, type });
    },
    async signedUrl(bucket, path, ttl) {
      if (!files.has(`${bucket}/${path}`)) throw new AppError(404, 'NOT_FOUND', 'File not found');
      return `https://storage.test/${bucket}/${path}?ttl=${ttl}`;
    },
    async remove(bucket, path) {
      files.delete(`${bucket}/${path}`);
    },
  };
}
