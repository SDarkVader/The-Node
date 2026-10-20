import { Readable } from 'node:stream';

export class BodyError extends Error {}

// This attaches its error handler BEFORE every destruction path. Error bodies are
// discarded without decoding or logging; caller owns uncertain-cost accounting.
export function readBoundedJson(body: Readable, status: number, limit = 262_144, deadlineMs = 12_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (code: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chunks.length = 0;
      reject(new BodyError(code));
      body.destroy();
    };
    // Keep the listener after settlement: destroy() can emit an asynchronous error.
    body.on('error', () => finish('body_error'));
    const timer = setTimeout(() => finish('body_timeout'), deadlineMs);
    body.on('close', () => { if (!done) finish('body_closed'); });
    body.on('data', (chunk: unknown) => {
      if (done) return;
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        finish('body_type'); return;
      }
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) { finish('body_too_large'); return; }
      chunks.push(bytes);
    });
    body.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new BodyError('body_json')); }
      chunks.length = 0;
    });
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
      finish('body_bounds'); return;
    }
    if (!Number.isInteger(status) || status < 200 || status >= 300) finish('http_rejected');
  });
}
