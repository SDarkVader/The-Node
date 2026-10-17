import {afterEach,describe,it,expect} from 'vitest';
import {WebSocket,type ClientOptions} from 'ws';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {startParticipantSocket,sendWithinBound} from '../src/server/participantSocket.js';
import {OfflineParticipantHost} from '../src/agent/host.js';
import {fixtureGenesis,createParticipantState} from '../src/agent/participantWorld.js';
import {DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import {replay,evidenceHash} from '../src/agent/replay.js';

const token='local-socket-controller-fixture';
const clients:WebSocket[]=[];
const servers:Awaited<ReturnType<typeof startParticipantSocket>>[]=[];
type Message=Record<string,any>;
async function waitFor<T>(read:()=>T|undefined):Promise<T>{
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){const result=read();if(result!==undefined)return result;await new Promise(r=>setTimeout(r,5));}
  throw Error('test_event_timeout');
}
function client(url:string,options:ClientOptions={}){
  const ws=new WebSocket(url,options);clients.push(ws);
  const messages:Message[]=[];let closed:number|undefined;
  ws.on('error',()=>{});ws.on('message',bytes=>messages.push(JSON.parse(bytes.toString())));ws.on('close',code=>{closed=code;});
  return {ws,messages,closed:()=>closed,take:async(type:string)=>waitFor(()=>{
    const index=messages.findIndex(m=>m.type===type);return index<0?undefined:messages.splice(index,1)[0];
  })};
}
async function setup(options:Omit<Parameters<typeof startParticipantSocket>[0],'host'>={}){
  const genesis=fixtureGenesis(32,{...DEFAULT_WORLD_CONFIG,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
  const person=[...createParticipantState(genesis).registry.people.values()].find(p=>p.role==='baker')!;
  const host=new OfflineParticipantHost(genesis,person.id,token);
  const server=await startParticipantSocket({host,...options});servers.push(server);
  return {host,server,person,genesis};
}
async function authenticate(server:Awaited<ReturnType<typeof startParticipantSocket>>,options:ClientOptions={}){
  const c=client(server.url,options);await once(c.ws,'open');
  c.ws.send(JSON.stringify({type:'authenticate',token}));
  const observation=await c.take('observation');return {...c,observation};
}
const frame=(o:Message,action:string,payload:unknown)=>({type:'action',tick:o.context.tick,observationId:o.observationId,action,payload});
async function rejectedUpgrade(url:string,options:ClientOptions={}){
  const ws=new WebSocket(url,options);clients.push(ws);ws.on('error',()=>{});
  return new Promise<number>((resolve,reject)=>{
    ws.on('open',()=>reject(Error('unexpected_upgrade')));
    ws.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode!);ws.terminate();});
    ws.on('error',()=>resolve(0));
  });
}
async function duplicateOriginUpgrade(url:string){
  const address=new URL(url);
  const socket=createConnection({host:'127.0.0.1',port:Number(address.port)});
  try{
    await once(socket,'connect');
    socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\nOrigin: https://local.example\r\nOrigin: https://evil.example\r\n\r\n`);
    const [response]=await once(socket,'data');return Number(response.toString().split(' ')[1]);
  }finally{socket.destroy();}
}
afterEach(async()=>{
  for(const ws of clients.splice(0))ws.terminate();
  await Promise.all(servers.splice(0).map(s=>s.close()));
});

describe('authenticated loopback participant transport',()=>{
  it('discloses nothing before authentication and rejects query-only identity',async()=>{
    const {server}=await setup();const c=client(server.url);await once(c.ws,'open');
    expect(c.messages).toEqual([]);c.ws.send(JSON.stringify({type:'action',action:'bakerPrice',payload:{price:1}}));
    expect(await waitFor(c.closed)).toBe(1008);expect(c.messages).toEqual([]);
    expect(await rejectedUpgrade(server.url+'?player=claimed')).toBe(403);
  });
  it('rejects a wrong token without exposing it and permits a subsequent valid controller',async()=>{
    const {server}=await setup();const c=client(server.url);await once(c.ws,'open');
    c.ws.send(JSON.stringify({type:'authenticate',token:'wrong-token'}));
    expect(await waitFor(c.closed)).toBe(1008);expect(c.messages).toEqual([]);
    expect((await authenticate(server)).observation.type).toBe('observation');
  });
  it('authenticates, executes three real prices and replays complete socket-driven state',async()=>{
    const {server,host,person,genesis}=await setup();const c=await authenticate(server);let o=c.observation;
    const captured:Message[]=[o];
    for(const price of [0.25,0.75,1.25]){
      c.ws.send(JSON.stringify(frame(o,'bakerPrice',{price})));await c.take('queued');server.advance();
      expect((await c.take('admission')).accepted).toBe(true);o=await c.take('observation');captured.push(o);
      expect(o.projection.self.price).toBe(price);
    }
    const tape=host.exportTape();expect(evidenceHash(replay(tape,genesis.sourceRevision))).toBe(host.evidence());
    const text=JSON.stringify(captured);
    expect(text).not.toContain(person.id);expect(text).not.toContain(token);expect(text).not.toContain(genesis.observerSecret);
    expect(text).not.toContain('genesisHash');expect(text).not.toContain('sourceRevision');
  });
  it('rejects stale observations without admitting an economic override',async()=>{
    const {server,host}=await setup();const c=await authenticate(server);const old=c.observation;
    server.advance();await c.take('observation');c.ws.send(JSON.stringify(frame(old,'bakerPrice',{price:2})));
    await c.take('queued');server.advance();expect(await c.take('admission')).toMatchObject({accepted:false,code:'stale_observation'});
    expect(host.exportTape().ticks.at(-1)!.actions).toEqual([]);
  });
  it('enforces per-category quotas at admission, preserving the first valid price',async()=>{
    const {server}=await setup();const c=await authenticate(server);
    c.ws.send(JSON.stringify(frame(c.observation,'bakerPrice',{price:0.5})));await c.take('queued');
    c.ws.send(JSON.stringify(frame(c.observation,'bakerPrice',{price:1.9})));await c.take('queued');
    server.advance();expect((await c.take('admission')).accepted).toBe(true);
    expect(await c.take('admission')).toMatchObject({accepted:false,code:'category_quota'});
    expect((await c.take('observation')).projection.self.price).toBe(0.5);
  });
  it('rejects extra authorship fields and remote advancement commands',async()=>{
    const {server,host}=await setup();const c=await authenticate(server);
    c.ws.send(JSON.stringify({...frame(c.observation,'bakerPrice',{price:1}),author:'foreign'}));await c.take('queued');
    c.ws.send(JSON.stringify({type:'advance'}));await c.take('queued');
    expect(host.exportTape().ticks).toHaveLength(0);server.advance();
    expect((await c.take('admission')).accepted).toBe(false);expect((await c.take('admission')).accepted).toBe(false);
    expect(host.exportTape().ticks[0]!.actions).toEqual([]);
  });
  it('refuses a second controller without disconnecting the legitimate lease',async()=>{
    const {server}=await setup();const first=await authenticate(server);const second=client(server.url);await once(second.ws,'open');
    second.ws.send(JSON.stringify({type:'authenticate',token}));expect(await waitFor(second.closed)).toBe(1008);
    server.advance();expect((await first.take('observation')).context.tick).toBe(1);
  });
  it('disconnect removes queued proposals and permits safe authenticated reconnection',async()=>{
    const {server,host}=await setup();const c=await authenticate(server);
    c.ws.send(JSON.stringify(frame(c.observation,'bakerPrice',{price:2})));await c.take('queued');c.ws.close();await waitFor(c.closed);
    const replacement=await authenticate(server);server.advance();await replacement.take('observation');
    expect(host.exportTape().ticks[0]!.actions).toEqual([]);
  });
  it('requires exact allowed Origins in both header variants',async()=>{
    const {server}=await setup({allowedOrigins:['https://local.example']});
    expect(await rejectedUpgrade(server.url,{origin:'https://evil.example'})).toBe(403);
    expect(await rejectedUpgrade(server.url,{origin:'https://local.example',headers:{'Sec-WebSocket-Origin':'https://evil.example'}})).toBe(403);
    expect((await authenticate(server,{origin:'https://local.example'})).observation.type).toBe('observation');
  });
  it('denies browser Origins by default and duplicate Origin headers even when one is allowed',async()=>{
    const {server}=await setup();expect(await rejectedUpgrade(server.url,{origin:'https://local.example'})).toBe(403);
    const allowed=await setup({allowedOrigins:['https://local.example']});
    expect(await duplicateOriginUpgrade(allowed.server.url)).toBe(403);
    expect(await rejectedUpgrade(allowed.server.url.replace(/\/$/,'/other'))).toBe(403);
  });
  it('rejects malformed JSON and binary frames without crashing the server',async()=>{
    const {server}=await setup();const malformed=client(server.url);await once(malformed.ws,'open');malformed.ws.send('{bad');
    expect(await waitFor(malformed.closed)).toBe(1008);
    const binary=client(server.url);await once(binary.ws,'open');binary.ws.send(Buffer.from('binary'));
    expect(await waitFor(binary.closed)).toBe(1003);expect((await authenticate(server)).observation.type).toBe('observation');
  });
  it('rejects aggregate oversized messages at the WebSocket payload boundary',async()=>{
    const {server}=await setup();const c=client(server.url);await once(c.ws,'open');c.ws.send('x'.repeat(4097));
    expect(await waitFor(c.closed)).toBe(1009);expect(c.messages).toEqual([]);
    const fragmented=client(server.url);await once(fragmented.ws,'open');
    fragmented.ws.send('x'.repeat(3000),{fin:false});fragmented.ws.send('y'.repeat(2000),{fin:true});
    expect(await waitFor(fragmented.closed)).toBe(1009);expect(fragmented.messages).toEqual([]);
  });
  it('enforces per-second frame rate before a flood can advance the game',async()=>{
    const {server,host}=await setup({limits:{framesPerSecond:3}});const c=await authenticate(server);
    for(let i=0;i<3;i++)c.ws.send(JSON.stringify(frame(c.observation,'bakerPrice',{price:1})));
    expect(await waitFor(c.closed)).toBe(1008);server.advance();expect(host.exportTape().ticks[0]!.actions).toEqual([]);
  });
  it('counts control frames too and returns a bounded standard pong',async()=>{
    const {server}=await setup({limits:{framesPerSecond:3}});const c=await authenticate(server);
    const pong=once(c.ws,'pong');c.ws.ping('probe');expect((await pong)[0].toString()).toBe('probe');
    c.ws.ping('two');c.ws.ping('three');expect(await waitFor(c.closed)).toBe(1008);
  });
  it('bounds per-socket and global pending queues and drops their authority on overflow',async()=>{
    for(const limits of [{queuedPerSocket:2},{queuedGlobally:1}]){
      const {server,host}=await setup({limits});const c=await authenticate(server);
      for(let i=0;i<3;i++)c.ws.send(JSON.stringify(frame(c.observation,'bakerPrice',{price:1})));
      expect(await waitFor(c.closed)).toBe(1008);server.advance();expect(host.exportTape().ticks[0]!.actions).toEqual([]);
    }
  });
  it('expires unauthenticated connections on the bounded authentication deadline',async()=>{
    const {server}=await setup({limits:{authMs:30}});const c=client(server.url);await once(c.ws,'open');
    expect(await waitFor(c.closed)).toBe(1008);expect(c.messages).toEqual([]);
  });
  it('terminates a client that stops answering heartbeat pings and releases its lease',async()=>{
    const {server}=await setup({limits:{heartbeatMs:40}});const c=await authenticate(server,{autoPong:false} as ClientOptions);
    await waitFor(c.closed);expect((await authenticate(server)).observation.type).toBe('observation');
  });
  it('refuses an oversized observation instead of unbounded output buffering',async()=>{
    const {server}=await setup({limits:{outputBytes:64}});const c=client(server.url);await once(c.ws,'open');
    c.ws.send(JSON.stringify({type:'authenticate',token}));expect(await waitFor(c.closed)).toBe(1009);expect(c.messages).toEqual([]);
  });
  it('enforces a socket cap, including unauthenticated connections',async()=>{
    const {server}=await setup({limits:{sockets:2}});const a=client(server.url);await once(a.ws,'open');const b=client(server.url);await once(b.ws,'open');
    expect(await rejectedUpgrade(server.url)).toBe(0);
  });
  it('closes all connections, revokes authority and stops accepting after shutdown',async()=>{
    const {server,host}=await setup();const c=await authenticate(server);const unauth=client(server.url);await once(unauth.ws,'open');
    await server.close();await server.close();await waitFor(c.closed);await waitFor(unauth.closed);
    expect(()=>server.advance()).toThrow('transport_closed');expect(()=>host.authenticate(token)).toThrow('authentication_failed');
    expect(await rejectedUpgrade(server.url)).toBe(0);
  });
  it('never widens configured transport caps',async()=>{
    const genesis=fixtureGenesis(32);const person=[...createParticipantState(genesis).registry.people.values()].find(p=>p.role==='baker')!;
    const host=new OfflineParticipantHost(genesis,person.id,token);
    await expect(startParticipantSocket({host,limits:{inputBytes:5000}})).rejects.toThrow('invalid_transport_limits');host.close();
  });
});

it('rejects slow-socket buffered output before calling send and handles asynchronous write failure',async()=>{
  let writes=0,failures=0;
  expect(sendWithinBound({readyState:WebSocket.OPEN,bufferedAmount:1024,send:()=>{writes++;}}, {type:'observation'},1024,()=>{failures++;})).toBe(false);
  expect(writes).toBe(0);expect(failures).toBe(1);
  sendWithinBound({readyState:WebSocket.OPEN,bufferedAmount:0,send:(_text,done)=>{setImmediate(()=>done(Error('private-error')));}}, {type:'ack'},1024,()=>{failures++;});
  await waitFor(()=>failures===2?true:undefined);
  const before=failures;
  const socket={readyState:WebSocket.OPEN,bufferedAmount:0,send:()=>{writes++;}};
  expect(sendWithinBound(socket,{type:'ack'},Buffer.byteLength(JSON.stringify({type:'ack'})),()=>{failures++;})).toBe(false);
  expect(sendWithinBound(socket,undefined,1024,()=>{failures++;})).toBe(false);
  expect(failures).toBe(before+2);expect(writes).toBe(0);
});
