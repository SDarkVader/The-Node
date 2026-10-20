import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Genesis } from './participantWorld.js';
import type { OfflineParticipantHost } from './host.js';
import type { Decision } from './protocol.js';
import type { AuthorizedObservation } from './responsesRequest.js';

/** Allowlist rather than removing two known names. No NODE_OPTIONS, TLS override, provider key/token or env-file loader. */
export function hostProcessEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(['systemroot', 'windir', 'temp', 'tmp', 'path', 'pathext', 'comspec', 'lang', 'lc_all', 'tz']);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase())));
}
interface HostOptions { entryFile?: string; timeoutMs?: number }
export interface IsolatedHostStart extends HostOptions { genesis: Genesis; person: string; controllerToken: string; checkpointDirectory?: string }
export interface IsolatedHostResume extends HostOptions { sourceRevision: string; controllerToken: string; checkpointDirectory: string }
type Pending = { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Credential-separated mechanical host over a private IPC channel. Same-user filesystem access is not sandboxed. */
export class IsolatedParticipantHost {
  #child: ChildProcess;
  #pending: Pending | null = null;
  #next = 1;
  #ended = false;
  #exit: Promise<void>;
  private constructor(options: HostOptions) {
    const timeout = options.timeoutMs ?? 4_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 12_000) throw Error('host_timeout_invalid');
    this.timeout = timeout;
    this.#child = spawn(process.execPath, [options.entryFile ?? fileURLToPath(new URL('./isolatedHostChild.js', import.meta.url))], {
      env: hostProcessEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', windowsHide: true,
    });
    this.#exit = new Promise(resolve => this.#child.once('exit', () => { this.#stop('host_exited'); resolve(); }));
    this.#child.on('error', () => this.#stop('host_process_failed'));
    this.#child.on('message', (message: unknown) => {
      const pending = this.#pending;
      if (!pending || !object(message) || message.id !== pending.id || typeof message.ok !== 'boolean' ||
        Object.keys(message).sort().join(',') !== (message.ok ? 'id,ok,value' : 'error,id,ok') || Buffer.byteLength(JSON.stringify(message)) > 8 * 1024 * 1024) {
        this.#stop('host_protocol_invalid'); this.#child.kill(); return;
      }
      clearTimeout(pending.timer); this.#pending = null;
      if (message.ok) pending.resolve(message.value); else pending.reject(Error('host_command_rejected'));
    });
  }
  private timeout: number;
  #stop(code: string): void {
    this.#ended = true;
    const pending = this.#pending; this.#pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(Error(code)); }
  }
  #rpc(op: string, payload: unknown = null): Promise<unknown> {
    if (this.#ended || !this.#child.connected) return Promise.reject(Error('host_unavailable'));
    if (this.#pending) return Promise.reject(Error('host_request_in_flight'));
    const id = this.#next++, packet = { id, op, payload };
    if (Buffer.byteLength(JSON.stringify(packet)) > 65_536) return Promise.reject(Error('host_request_too_large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#stop('host_deadline'); this.#child.kill(); }, this.timeout);
      this.#pending = { id, resolve, reject, timer };
      this.#child.send(packet, error => { if (error) { this.#stop('host_ipc_failed'); this.#child.kill(); } });
    });
  }
  static async create(options: IsolatedHostStart): Promise<IsolatedParticipantHost> {
    const host = new IsolatedParticipantHost(options);
    try { await host.#rpc('init', { genesis: options.genesis, person: options.person, controllerToken: options.controllerToken, checkpointDirectory: options.checkpointDirectory ?? null }); return host; }
    catch (error) { host.#child.kill(); await host.#exit; throw error; }
  }
  static async resume(options: IsolatedHostResume): Promise<IsolatedParticipantHost> {
    const host = new IsolatedParticipantHost(options);
    try { await host.#rpc('resume', { sourceRevision: options.sourceRevision, controllerToken: options.controllerToken, checkpointDirectory: options.checkpointDirectory }); return host; }
    catch (error) { host.#child.kill(); await host.#exit; throw error; }
  }
  async read(): Promise<AuthorizedObservation> { return await this.#rpc('read') as AuthorizedObservation; }
  async advance(): Promise<ReturnType<OfflineParticipantHost['advance']>> { return await this.#rpc('advance') as ReturnType<OfflineParticipantHost['advance']>; }
  async evidence(): Promise<string> { return await this.#rpc('evidence') as string; }
  async exportTape(): Promise<ReturnType<OfflineParticipantHost['exportTape']>> { return await this.#rpc('tape') as ReturnType<OfflineParticipantHost['exportTape']>; }
  async submitDecision(observation: AuthorizedObservation, decision: Decision): Promise<void> {
    const frame = (action: string, payload: unknown) => this.#rpc('submit', { type: 'action', tick: observation.context.tick, observationId: observation.observationId, action, payload });
    if (decision.move) await frame('move', decision.move);
    if (decision.communication) {
      const { kind, ...payload } = decision.communication;
      if (payload.context === null) delete payload.context;
      await frame(String(kind), payload);
    }
    if (decision.diary) { const { context, ...payload } = decision.diary; await frame('diaryEntry', context === null ? payload : { ...payload, context }); }
    if (decision.role) await frame('bakerPrice', { price: decision.role.price });
  }
  async close(): Promise<void> {
    if (!this.#ended) {
      try { await this.#rpc('close'); } catch { this.#child.kill(); }
    }
    await this.#exit;
  }
}
