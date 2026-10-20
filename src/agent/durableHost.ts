import {CheckpointStore,type CheckpointOpenOptions} from './checkpoint.js';
import {OfflineParticipantHost} from './host.js';
import type {Genesis} from './participantWorld.js';

const validateToken=(token:string)=>{if(typeof token!=='string'||token.length<16||token.length>256)throw Error('invalid_controller_token');};
/** Creates a NEW private participant checkpoint, never a spending ledger. Existing paths fail. */
export function createDurableHost(directory:string,genesis:Genesis,person:string,controllerToken:string,options:CheckpointOpenOptions={}):OfflineParticipantHost {
  validateToken(controllerToken);
  const store=CheckpointStore.create(directory,genesis,person,options);
  try{return new OfflineParticipantHost(genesis,person,controllerToken,store);}catch(error){store.release();throw error;}
}
/** Replays only existing verified evidence; missing/corrupt/closed/locked data never resets. */
export function openDurableHost(directory:string,expectedSourceRevision:string,controllerToken:string,options:CheckpointOpenOptions={}):OfflineParticipantHost {
  validateToken(controllerToken);
  const store=CheckpointStore.open(directory,expectedSourceRevision,options);
  const record=store.current();
  try{return new OfflineParticipantHost(record.tape.genesis,record.person,controllerToken,store);}catch(error){store.release();throw error;}
}
