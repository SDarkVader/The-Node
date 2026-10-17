import * as http from 'node:http';
import * as https from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { assertLiveAdmission } from './broker.js';
import { isResponsesRequest, type ResponsesRequest } from './responsesRequest.js';

export class ResponsesTransportError extends Error {
  constructor(code: string) { super(code); this.name = 'ResponsesTransportError'; }
}
const fail = (code: string): never => { throw new ResponsesTransportError(code); };
export interface ManagedResponsesRoute { proxyUrl: string; caPem: string }
export interface LoopbackResponsesRoute { proxyUrl?: string; caPem?: string; deadlineMs?: number }
const endpoint = new URL('https://api.openai.com/v1/responses');

function proxyAddress(value: string, loopback: boolean): URL {
  let url: URL; try { url = new URL(value); } catch { return fail('responses_proxy_invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    loopback && (url.hostname !== '127.0.0.1' || !url.port)) return fail('responses_proxy_invalid');
  return url;
}
function ca(value: unknown, required: boolean): string | undefined {
  if (!required && value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 262_144 || !/^(?:\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*)+$/.test(value)) return fail('responses_ca_invalid');
  return value;
}

/** Entire DNS/CONNECT/TLS/header/body lifecycle shares one absolute deadline. No retries or redirects. */
async function exchange(request: ResponsesRequest, target: URL, bearer: string, route: LoopbackResponsesRoute, signal: AbortSignal, loopback: boolean): Promise<Buffer> {
  if (!isResponsesRequest(request)) return fail('responses_request_untrusted');
  const deadlineMs = route.deadlineMs ?? 12_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 12_000) return fail('responses_deadline_invalid');
  const proxy = route.proxyUrl === undefined ? null : proxyAddress(route.proxyUrl, loopback);
  const caPem = ca(route.caPem, !loopback);
  if (signal.aborted) return fail('responses_aborted');
  return new Promise<Buffer>((resolve, reject) => {
    let done = false, size = 0; const chunks: Buffer[] = [];
    const resources = new Set<{ destroy(): unknown; on(event: 'error', listener: () => void): unknown }>();
    const timer = setTimeout(() => finish('responses_deadline'), deadlineMs);
    const abort = () => finish('responses_aborted');
    function finish(error?: string, bytes?: Buffer): void {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); chunks.length = 0;
      for (const resource of resources) resource.destroy(); resources.clear();
      if (error) reject(new ResponsesTransportError(error)); else resolve(bytes!);
    }
    function track<T extends { destroy(): unknown; on(event: 'error', listener: () => void): unknown }>(value: T): boolean {
      // Keep error listeners through asynchronous destruction, including rejected HTTP bodies.
      value.on('error', () => finish('responses_transport_error'));
      if (done) { value.destroy(); return false; } resources.add(value); return true;
    }
    function receive(response: http.IncomingMessage): void {
      if (!track(response)) return;
      const status = response.statusCode;
      if (!Number.isInteger(status) || status! < 200 || status! >= 300) { finish(`responses_http_${Number.isInteger(status) ? status : 'invalid'}`); return; }
      const type = response.headers['content-type'];
      if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
        response.headers['content-encoding'] !== undefined && response.headers['content-encoding'] !== 'identity') { finish('responses_headers_rejected'); return; }
      const length = response.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || BigInt(length) > 262_144n)) { finish('responses_body_too_large'); return; }
      response.on('data', (chunk: Buffer) => {
        if (done) return;
        if (!Buffer.isBuffer(chunk)) { finish('responses_body_invalid'); return; }
        size += chunk.length;
        if (size > 262_144) { finish('responses_body_too_large'); return; }
        chunks.push(chunk);
      });
      response.once('end', () => { if (!done) finish(undefined, Buffer.concat(chunks)); });
      response.once('close', () => { if (!done) finish('responses_body_closed'); });
    }
    function send(socket?: Duplex): void {
      if (done) return;
      const options: http.RequestOptions & https.RequestOptions = { method: 'POST', maxHeaderSize: 16_384,
        headers: { Host: target.host, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json',
          'Accept-Encoding': 'identity', 'Content-Length': Buffer.byteLength(request.body), Connection: 'close' } };
      try {
        const outgoing = socket
          ? http.request({ ...options, hostname: target.hostname, port: target.port || 443, path: target.pathname, createConnection: () => socket }, receive)
          : target.protocol === 'https:'
            ? https.request(target, { ...options, agent: false, ca: caPem, rejectUnauthorized: true, servername: loopback ? 'localhost' : endpoint.hostname }, receive)
            : http.request(target, { ...options, agent: false }, receive);
        if (track(outgoing)) outgoing.end(request.body);
      } catch { finish('responses_transport_error'); }
    }
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    if (!proxy) { send(); return; }
    try {
      const authority = `${target.hostname}:${target.port || 443}`;
      const options = { method: 'CONNECT', path: authority, headers: { Host: authority }, agent: false as const, maxHeaderSize: 16_384,
        ca: caPem, rejectUnauthorized: true };
      const connect = proxy.protocol === 'https:' ? https.request(proxy, options) : http.request(proxy, options);
      if (!track(connect)) return;
      connect.once('connect', (response, socket, head) => {
        if (!track(socket)) return;
        response.on('error', () => finish('responses_proxy_error'));
        if (response.statusCode !== 200 || head.length) { finish('responses_proxy_rejected'); return; }
        try {
          const secure = tlsConnect({ socket, servername: loopback ? 'localhost' : endpoint.hostname, ca: caPem,
            rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] });
          if (track(secure)) secure.once('secureConnect', () => send(secure));
        } catch { finish('responses_proxy_error'); }
      });
      connect.once('response', response => { response.on('error', () => {}); response.destroy(); finish('responses_proxy_rejected'); });
      connect.end();
    } catch { finish('responses_proxy_error'); }
  });
}

/** Production entrypoint: unconditional protected gate runs before any key read, socket, DNS or proxy work. */
export async function sendLiveResponses(request: ResponsesRequest, getApiKey: () => string, route: ManagedResponsesRoute, signal: AbortSignal, deadlineMs = 12_000): Promise<Buffer> {
  assertLiveAdmission();
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 12_000) return fail('responses_deadline_invalid');
  const started = performance.now();
  if (!isResponsesRequest(request) || typeof getApiKey !== 'function' || !route || Object.keys(route).sort().join(',') !== 'caPem,proxyUrl' ||
    Object.values(Object.getOwnPropertyDescriptors(route)).some(d => !Object.hasOwn(d, 'value'))) return fail('responses_configuration_invalid');
  let key: string; try { key = getApiKey(); } catch { return fail('responses_credential_unavailable'); }
  if (typeof key !== 'string' || key.length > 512 || !/^sk-[A-Za-z0-9_-]{8,}$/.test(key)) return fail('responses_credential_invalid');
  proxyAddress(route.proxyUrl, false); ca(route.caPem, true);
  const remainingMs = Math.floor(deadlineMs - (performance.now() - started));
  if (remainingMs < 1) return fail('responses_deadline');
  return exchange(request, endpoint, key, { ...route, deadlineMs: remainingMs }, signal, false);
}

/** Mechanical local-service fixture only: literal loopback URL, fixed fake bearer, no key accessor or real endpoint override. */
export function validateLoopbackResponsesRoute(url: string, route: LoopbackResponsesRoute = {}): URL {
  let target: URL; try { target = new URL(url); } catch { return fail('responses_fixture_endpoint'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password ||
    target.pathname !== '/v1/responses' || target.search || target.hash ||
    Object.keys(route).some(key => !['proxyUrl', 'caPem', 'deadlineMs'].includes(key)) || route.proxyUrl !== undefined && target.protocol !== 'https:') return fail('responses_fixture_endpoint');
  if (route.proxyUrl !== undefined) proxyAddress(route.proxyUrl, true);
  ca(route.caPem, false);
  if (route.deadlineMs !== undefined && (!Number.isSafeInteger(route.deadlineMs) || route.deadlineMs < 1 || route.deadlineMs > 12_000)) return fail('responses_deadline_invalid');
  return target;
}
export async function sendLoopbackResponsesFixture(request: ResponsesRequest, url: string, route: LoopbackResponsesRoute = {}, signal: AbortSignal = new AbortController().signal): Promise<Buffer> {
  const target = validateLoopbackResponsesRoute(url, route);
  return exchange(request, target, 'fixture-only-no-provider-key', route, signal, true);
}
