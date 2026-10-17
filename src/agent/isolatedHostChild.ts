import { OfflineParticipantHost } from './host.js';
import { createDurableHost, openDurableHost } from './durableHost.js';
import type { Genesis } from './participantWorld.js';

// A mechanical game host, not an agent/provider worker. It never imports a provider adapter or env-file loader.
if (!process.send || Object.keys(process.env).some(k => /^(OPENAI_API_KEY|NODE_AI_API_KEY)$/i.test(k))) process.exit(78);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
let host: OfflineParticipantHost | undefined, session: string | undefined, initialized = false;
const reply = (id: number, ok: boolean, value: unknown, shutdown = false) => {
  let packet = ok ? { id, ok, value } : { id, ok, error: 'host_command_rejected' };
  if (Buffer.byteLength(JSON.stringify(packet)) > 8 * 1024 * 1024) packet = { id, ok: false, error: 'host_response_too_large' };
  process.send!(packet, () => { if (shutdown) { process.disconnect(); process.exit(0); } });
};
process.on('message', (message: unknown) => {
  if (!object(message) || !exact(message, ['id', 'op', 'payload']) || !Number.isSafeInteger(message.id) || Number(message.id) < 1 ||
    typeof message.op !== 'string' || Buffer.byteLength(JSON.stringify(message)) > 65_536) { process.exit(78); }
  const id = message.id as number, op = message.op, payload = message.payload;
  try {
    if (op === 'init') {
      if (initialized || !object(payload) || !exact(payload, ['genesis', 'person', 'controllerToken', 'checkpointDirectory']) || typeof payload.person !== 'string' ||
        typeof payload.controllerToken !== 'string' || !(payload.checkpointDirectory === null || typeof payload.checkpointDirectory === 'string')) throw Error();
      host = payload.checkpointDirectory === null ? new OfflineParticipantHost(payload.genesis as Genesis, payload.person, payload.controllerToken)
        : createDurableHost(payload.checkpointDirectory, payload.genesis as Genesis, payload.person, payload.controllerToken);
      session = host.authenticate(payload.controllerToken); initialized = true;
      reply(id, true, { ready: true }); return;
    }
    if (op === 'resume') {
      if (initialized || !object(payload) || !exact(payload, ['sourceRevision', 'controllerToken', 'checkpointDirectory']) ||
        typeof payload.sourceRevision !== 'string' || typeof payload.controllerToken !== 'string' || typeof payload.checkpointDirectory !== 'string') throw Error();
      host = openDurableHost(payload.checkpointDirectory, payload.sourceRevision, payload.controllerToken, { resumeCleanShutdown: true });
      session = host.authenticate(payload.controllerToken); initialized = true; reply(id, true, { ready: true }); return;
    }
    if (!host || !session || !initialized) throw Error();
    if (op === 'submit') { host.submit(session, payload); reply(id, true, null); return; }
    if (payload !== null) throw Error();
    switch (op) {
      case 'read': reply(id, true, host.read(session)); return;
      case 'advance': reply(id, true, host.advance()); return;
      case 'evidence': reply(id, true, host.evidence()); return;
      case 'tape': reply(id, true, host.exportTape()); return;
      case 'close': host.close(); host = undefined; session = undefined; reply(id, true, null, true); return;
      default: throw Error();
    }
  } catch { reply(id, false, null); }
});
process.once('disconnect', () => { try { host?.close(); } catch {} process.exit(0); });
