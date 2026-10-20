import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sendLiveResponses, sendLoopbackResponsesFixture } from '../src/agent/responsesTransport.js';
import { participant, listen, cleanupResponses } from './fixtures/responsesFixture.js';
import { response } from './fixtures/accountingFixture.js';

const certRoot = mkdtempSync(join(tmpdir(), 'node-responses-tls-fixture-'));
let cert: Buffer, key: Buffer;
beforeAll(() => {
  const bundled = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe');
  const executable = process.platform === 'win32' && existsSync(bundled) ? bundled : 'openssl';
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH'].flatMap(k => process.env[k] === undefined ? [] : [[k, process.env[k]!]]));
  execFileSync(executable, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certRoot, 'fixture.key.pem'), '-out', join(certRoot, 'fixture.cert.pem'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', env, windowsHide: true });
  cert = readFileSync(join(certRoot, 'fixture.cert.pem')); key = readFileSync(join(certRoot, 'fixture.key.pem'));
});
afterEach(cleanupResponses);
afterAll(() => rmSync(certRoot, { recursive: true, force: true }));

describe('real local HTTP lifecycle, invented fixture bearer only', () => {
  it('sends the exact bounded final body and returns raw response bytes without envelope rewriting', async () => {
    const p = participant(); let received = '', authorization: unknown;
    const url = await listen(createServer((req, res) => {
      authorization = req.headers.authorization; expect(req.method).toBe('POST'); expect(req.url).toBe('/v1/responses');
      req.on('data', data => { received += data; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response()); });
    }));
    const bytes = await sendLoopbackResponsesFixture(p.request, url);
    expect(bytes.equals(response())).toBe(true); expect(received).toBe(p.request.body); expect(authorization).toBe('Bearer fixture-only-no-provider-key');
  });
  it.each([401, 403, 429, 500])('discards HTTP %s bodies without leaking text or retrying', async status => {
    let calls = 0; const url = await listen(createServer((_req, res) => { calls++; res.writeHead(status); res.end('private-provider-error-text'); }));
    await expect(sendLoopbackResponsesFixture(participant().request, url)).rejects.toThrow(`responses_http_${status}`); expect(calls).toBe(1);
  });
  it('never follows a redirect', async () => {
    let redirected = 0;
    const second = await listen(createServer((_req, res) => { redirected++; res.end(); }));
    const first = await listen(createServer((_req, res) => { res.writeHead(302, { Location: second }); res.end('not decoded'); }));
    await expect(sendLoopbackResponsesFixture(participant().request, first)).rejects.toThrow('responses_http_302'); expect(redirected).toBe(0);
  });
  it.each([
    { 'Content-Type': 'text/html' }, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    { 'Content-Type': 'application/json', 'Content-Length': '262145' },
  ])('rejects incompatible response headers %j', headers => {
    return listen(createServer((_req, res) => { res.writeHead(200, headers); res.end('not processed'); }))
      .then(url => expect(sendLoopbackResponsesFixture(participant().request, url)).rejects.toThrow());
  });
  it('enforces the byte limit for chunked bodies with no declared length', async () => {
    const url = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write(Buffer.alloc(200_000)); res.end(Buffer.alloc(100_000)); }));
    await expect(sendLoopbackResponsesFixture(participant().request, url)).rejects.toThrow('responses_body_too_large');
  });
  it('bounds the whole request before headers arrive', async () => {
    const url = await listen(createServer(() => {})); const started = performance.now();
    await expect(sendLoopbackResponsesFixture(participant().request, url, { deadlineMs: 100 })).rejects.toThrow('responses_deadline');
    expect(performance.now() - started).toBeLessThan(1500);
  });
  it('uses an absolute body deadline even while data continues arriving', async () => {
    const url = await listen(createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders();
      const interval = setInterval(() => res.write(' '), 10); req.socket.once('close', () => clearInterval(interval));
    }));
    await expect(sendLoopbackResponsesFixture(participant().request, url, { deadlineMs: 100 })).rejects.toThrow('responses_deadline');
  });
  it('cancels an in-flight request and does not open a socket for pre-aborted input', async () => {
    let calls = 0; const controller = new AbortController();
    const url = await listen(createServer(() => { calls++; controller.abort(); }));
    await expect(sendLoopbackResponsesFixture(participant().request, url, {}, controller.signal)).rejects.toThrow('responses_aborted'); expect(calls).toBe(1);
    await expect(sendLoopbackResponsesFixture(participant().request, url, {}, controller.signal)).rejects.toThrow('responses_aborted'); expect(calls).toBe(1);
  });
  it('rejects prematurely closed response bodies', async () => {
    const url = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 100 }); res.flushHeaders(); res.write('{'); setImmediate(() => res.destroy()); }));
    await expect(sendLoopbackResponsesFixture(participant().request, url)).rejects.toThrow();
  });
  it('rejects oversized headers through the bounded native parser', async () => {
    const url = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'X-Fixture-Large': 'x'.repeat(20_000) }); res.end(response()); }));
    await expect(sendLoopbackResponsesFixture(participant().request, url)).rejects.toThrow('responses_transport_error');
  });
});

describe('verified TLS and explicit CONNECT route', () => {
  it('accepts only a trusted fixture certificate and keeps the final body intact', async () => {
    let body = ''; const server = createSecureServer({ cert, key }, (req, res) => { req.on('data', data => { body += data; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response()); }); });
    server.on('tlsClientError', () => {}); const url = await listen(server, true), p = participant();
    expect((await sendLoopbackResponsesFixture(p.request, url, { caPem: cert.toString() })).equals(response())).toBe(true); expect(body).toBe(p.request.body);
    await expect(sendLoopbackResponsesFixture(p.request, url, { deadlineMs: 500 })).rejects.toThrow('responses_transport_error');
  });
  it.each([false, true])('tunnels through a local CONNECT proxy (proxy TLS %s) with verified target TLS and no credential on CONNECT', async secureProxy => {
    let authorization: unknown, proxyAuthorization: unknown, authority = '', targetCalls = 0;
    const targetUrl = await listen(createSecureServer({ cert, key }, (req, res) => { targetCalls++; authorization = req.headers.authorization; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response()); }), true);
    const target = new URL(targetUrl); const proxy = secureProxy ? createSecureServer({ cert, key }) : createServer();
    proxy.on('connect', (req, incoming, head) => {
      authority = req.url!; proxyAuthorization = req.headers.authorization; expect(head.length).toBe(0);
      const upstream = connect(Number(target.port), '127.0.0.1', () => { incoming.write('HTTP/1.1 200 Connection Established\r\n\r\n'); incoming.pipe(upstream); upstream.pipe(incoming); });
      upstream.on('error', () => incoming.destroy()); incoming.once('close', () => upstream.destroy()); upstream.once('close', () => incoming.destroy());
    });
    const proxyUrl = new URL(await listen(proxy, secureProxy)); proxyUrl.pathname = '/';
    expect((await sendLoopbackResponsesFixture(participant().request, targetUrl, { proxyUrl: proxyUrl.href, caPem: cert.toString() })).equals(response())).toBe(true);
    expect(targetCalls).toBe(1); expect(authority).toBe(`127.0.0.1:${target.port}`); expect(proxyAuthorization).toBeUndefined(); expect(authorization).toBe('Bearer fixture-only-no-provider-key');
  });
  it('rejects CONNECT denial without retrying the target', async () => {
    let calls = 0; const proxy = createServer(); proxy.on('connect', (_req, socket) => { calls++; socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'); });
    const proxyUrl = new URL(await listen(proxy)); proxyUrl.pathname = '/';
    await expect(sendLoopbackResponsesFixture(participant().request, 'https://127.0.0.1:44443/v1/responses', { proxyUrl: proxyUrl.href, caPem: cert.toString() }))
      .rejects.toThrow('responses_proxy_rejected'); expect(calls).toBe(1);
  });
  it('bounds a stalled CONNECT handshake', async () => {
    const proxy = createServer(); proxy.on('connect', () => {}); const proxyUrl = new URL(await listen(proxy)); proxyUrl.pathname = '/';
    await expect(sendLoopbackResponsesFixture(participant().request, 'https://127.0.0.1:44443/v1/responses', { proxyUrl: proxyUrl.href, caPem: cert.toString(), deadlineMs: 100 }))
      .rejects.toThrow('responses_deadline');
  });
  it('bounds a stalled TLS handshake after CONNECT succeeds', async () => {
    const proxy = createServer(); proxy.on('connect', (_req, socket) => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); });
    const proxyUrl = new URL(await listen(proxy)); proxyUrl.pathname = '/';
    await expect(sendLoopbackResponsesFixture(participant().request, 'https://127.0.0.1:44443/v1/responses', { proxyUrl: proxyUrl.href, caPem: cert.toString(), deadlineMs: 100 }))
      .rejects.toThrow('responses_deadline');
  });
});

describe('closed production path and fixture containment', () => {
  it('blocks live access before even reading a credential or route', async () => {
    let reads = 0;
    await expect(sendLiveResponses(participant().request, () => { reads++; throw Error('must not read'); }, { get proxyUrl(): string { throw Error('must not inspect'); }, caPem: '' }, new AbortController().signal))
      .rejects.toThrow('recovery_accounting_unresolved'); expect(reads).toBe(0);
  });
  it.each(['https://api.openai.com/v1/responses', 'http://localhost:1234/v1/responses', 'http://127.0.0.1:1234/other',
    'http://user:pass@127.0.0.1:1234/v1/responses', 'http://127.0.0.1:1234/v1/responses?key=x'])('rejects fixture endpoint %s', endpoint => {
    return expect(sendLoopbackResponsesFixture(participant().request, endpoint)).rejects.toThrow('responses_fixture_endpoint');
  });
  it('rejects injected external proxies, malformed CA and forged serialized requests', async () => {
    const p = participant();
    await expect(sendLoopbackResponsesFixture(p.request, 'https://127.0.0.1:44443/v1/responses', { proxyUrl: 'http://external.example:8080/' })).rejects.toThrow('responses_proxy_invalid');
    await expect(sendLoopbackResponsesFixture(p.request, 'https://127.0.0.1:44443/v1/responses', { caPem: 'disable verification' })).rejects.toThrow('responses_ca_invalid');
    await expect(sendLoopbackResponsesFixture({ ...p.request }, 'http://127.0.0.1:44443/v1/responses')).rejects.toThrow('responses_request_untrusted');
  });
});
