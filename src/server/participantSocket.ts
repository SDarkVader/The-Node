import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { OfflineParticipantHost } from '../agent/host.js';

/** Local game transport only. No provider adapter, paid calls, CLI or automatic ticks. */
export const PARTICIPANT_LIMITS = Object.freeze({
  sockets:128, inputBytes:4096, framesPerSecond:64, queuedPerSocket:8,
  queuedGlobally:256, outputBytes:262144, authMs:5000, heartbeatMs:30000,
});
type Limits = typeof PARTICIPANT_LIMITS;
export interface ParticipantSocketOptions {
  host: OfflineParticipantHost;
  port?: number;
  allowedOrigins?: readonly string[];
  /** Limits may only be tightened, including in deterministic containment tests. */
  limits?: Partial<{[K in keyof Limits]: number}>;
}
interface Connection {
  socket: WebSocket;
  session: string | null;
  released: boolean;
  alive: boolean;
  frames: number;
  windowStart: number;
  queued: number;
  authTimer: ReturnType<typeof setTimeout>;
}
const object = (v: unknown): v is Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string,unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const rejectionCodes = new Set(['invalid_frame','invalid_payload','stale_observation','category_quota','invalid_proposal','unknown_action','invalid_session']);

/** Both Origin header variants are checked; duplicates never acquire authority. */
function allowedRequest(req: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  if (req.method !== 'GET' || req.url !== '/') return false;
  const seen = new Set<string>();
  for (let i=0;i<req.rawHeaders.length;i+=2) {
    const name = req.rawHeaders[i]!.toLowerCase();
    if (name !== 'origin' && name !== 'sec-websocket-origin') continue;
    if (seen.has(name) || !allowedOrigins.includes(req.rawHeaders[i+1]!)) return false;
    seen.add(name);
  }
  return true;
}

export interface OutputSocket {
  readyState: number;
  bufferedAmount: number;
  send: (text:string,callback:(error?:Error)=>void) => void;
}
/** Shared guard tested with slow-output fixtures as well as real sockets. */
export function sendWithinBound(socket: OutputSocket, value: unknown, maxBytes: number, onFailure:()=>void): boolean {
  let text:string|undefined;
  try{text=JSON.stringify(value);}catch{onFailure();return false;}
  if (typeof text!=='string'||!Number.isSafeInteger(maxBytes)||maxBytes<1||socket.readyState !== WebSocket.OPEN ||
      Buffer.byteLength(text,'utf8') + socket.bufferedAmount + 14 > maxBytes) {
    onFailure(); return false;
  }
  try { socket.send(text,error => {if (error) onFailure();}); }
  catch { onFailure(); return false; }
  return true;
}

export async function startParticipantSocket(options: ParticipantSocketOptions) {
  const limits: {[K in keyof Limits]: number} = {...PARTICIPANT_LIMITS,...options.limits};
  for (const name of Object.keys(limits) as (keyof Limits)[]) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1 || limits[name] > PARTICIPANT_LIMITS[name]) throw Error('invalid_transport_limits');
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) throw Error('invalid_port');
  const origins = [...(options.allowedOrigins ?? [])];
  if (origins.some(origin => {
    try { const url=new URL(origin);return !['https:','http:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) throw Error('invalid_origin_allowlist');
  const host=options.host;
  const http=createServer({maxHeaderSize:8192},(_req,res)=>{res.writeHead(404);res.end();});
  http.maxConnections=limits.sockets;
  http.headersTimeout=5000;http.requestTimeout=5000;http.keepAliveTimeout=1000;
  const wss=new WebSocketServer({noServer:true,maxPayload:limits.inputBytes,perMessageDeflate:false,autoPong:false});
  const connections=new Map<WebSocket,Connection>();
  const rawSockets=new Set<Socket>();
  let queue:{connection:Connection;frame:unknown}[]=[];
  let closing=false;
  let closePromise:Promise<void>|undefined;
  let heartbeat:ReturnType<typeof setInterval>|undefined;

  const release=(c:Connection) => {
    if (c.released) return;
    c.released=true;clearTimeout(c.authTimer);
    queue=queue.filter(entry=>entry.connection!==c);
    if (c.session!==null) {try{host.disconnect(c.session);}catch{/* Departed/closed already has no authority. */}}
    c.session=null;
  };
  const drop=(c:Connection,code=1008) => {
    release(c);
    // No peer-controlled values or credentials in close reasons or logs.
    if (c.socket.readyState===WebSocket.OPEN) c.socket.close(code,'transport_closed');
    const timer=setTimeout(()=>c.socket.terminate(),100);
    timer.unref();c.socket.once('close',()=>clearTimeout(timer));
  };
  const send=(c:Connection,value:unknown) => sendWithinBound(c.socket,value,limits.outputBytes,()=>drop(c,1009));
  const observe=(c:Connection) => {
    if (c.session===null || c.released) return;
    try {send(c,{type:'observation',...host.read(c.session)});}
    catch {drop(c);}
  };
  const countFrame=(c:Connection) => {
    if (c.released) return false;
    const now=performance.now();
    if (now-c.windowStart>=1000) {c.windowStart=now;c.frames=0;}
    if (++c.frames>limits.framesPerSecond) {drop(c);return false;}
    return true;
  };
  const rejectUpgrade=(socket:Socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const timer=setTimeout(()=>socket.destroy(),100);timer.unref();socket.once('close',()=>clearTimeout(timer));
  };
  http.on('connection',socket=>{rawSockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>rawSockets.delete(socket));});
  http.on('upgrade',(req,socket,head)=>{
    if (closing || wss.clients.size>=limits.sockets || !allowedRequest(req,origins)) {rejectUpgrade(socket as Socket);return;}
    try{wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));}
    catch{socket.destroy();}
  });
  wss.on('connection',(socket:WebSocket)=>{
    const c:Connection={socket,session:null,released:false,alive:true,frames:0,windowStart:performance.now(),queued:0,
      authTimer:setTimeout(()=>drop(c),limits.authMs)};
    c.authTimer.unref();connections.set(socket,c);
    socket.on('close',()=>{release(c);connections.delete(socket);});
    socket.on('error',()=>drop(c));
    socket.on('ping',bytes=>{
      if(!countFrame(c))return;
      // ws automatic pong would bypass the bounded-output guard under a slow reader.
      if(socket.bufferedAmount+bytes.length+14>limits.outputBytes){drop(c,1009);return;}
      try{socket.pong(bytes,false,error=>{if(error)drop(c);});}catch{drop(c);}
    });
    socket.on('pong',()=>{if(countFrame(c))c.alive=true;});
    socket.on('message',(bytes:RawData,isBinary:boolean)=>{
      if(!countFrame(c))return;
      if(isBinary){drop(c,1003);return;}
      let frame:unknown;
      try {frame=JSON.parse(bytes.toString());}catch{drop(c);return;}
      if(c.session===null){
        if(!object(frame)||!exact(frame,['type','token'])||frame.type!=='authenticate'||typeof frame.token!=='string'){drop(c);return;}
        try{c.session=host.authenticate(frame.token);}catch{drop(c);return;}
        clearTimeout(c.authTimer);observe(c);return;
      }
      if(c.queued>=limits.queuedPerSocket||queue.length>=limits.queuedGlobally){drop(c);return;}
      c.queued++;queue.push({connection:c,frame});
      send(c,{type:'queued'}); // Pending until the trusted tick boundary, not an effect claim.
    });
  });

  const close=():Promise<void>=>{
    if(closePromise)return closePromise;
    closing=true;clearInterval(heartbeat);queue=[];
    for(const c of connections.values()){release(c);c.socket.terminate();}
    host.close();
    for(const socket of rawSockets)socket.destroy();
    closePromise=Promise.all([
      new Promise<void>(resolve=>wss.close(()=>resolve())),
      new Promise<void>(resolve=>http.close(()=>resolve())),
    ]).then(()=>{});
    return closePromise;
  };
  wss.on('error',()=>{void close();});
  await new Promise<void>((resolve,reject)=>{
    const failure=()=>{void close();reject(Error('transport_start_failed'));};
    http.once('error',failure);
    http.listen(options.port??0,'127.0.0.1',()=>{http.off('error',failure);resolve();});
  });
  http.on('error',()=>{void close();});
  heartbeat=setInterval(()=>{
    for(const c of connections.values()){
      if(!c.alive){release(c);c.socket.terminate();continue;}
      c.alive=false;
      if(c.socket.bufferedAmount+14>limits.outputBytes){drop(c,1009);continue;}
      try{c.socket.ping(undefined,false,error=>{if(error)drop(c);});}catch{drop(c);}
    }
  },limits.heartbeatMs);
  heartbeat.unref();
  const address=http.address();
  if(address===null||typeof address==='string'){await close();throw Error('invalid_bound_address');}
  return {
    url:`ws://127.0.0.1:${address.port}/`,
    /** Trusted operator only. There is deliberately no remote tick/advance command. */
    advance:()=>{
      if(closing)throw Error('transport_closed');
      const batch=queue;queue=[];
      for(const c of connections.values())c.queued=0;
      for(const {connection:c,frame}of batch){
        if(c.released||c.session===null)continue;
        try{host.submit(c.session,frame);send(c,{type:'admission',accepted:true});}
        catch(error){
          const code=error instanceof Error && rejectionCodes.has(error.message)?error.message:'proposal_rejected';
          send(c,{type:'admission',accepted:false,code});
        }
      }
      try{host.advance();}catch{void close();throw Error('kernel_execution_failed');}
      for(const c of connections.values())observe(c);
    },
    close,
  };
}
