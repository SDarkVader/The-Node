/** Operator-owned Godot lifecycle. It has no provider or credential dependency. */
import {startPerceptionBridge,launchPerceptionWorker} from '../observatory/perceptionBridge.js';
export async function openSocietySenses(godotBin=process.env.NODE_GODOT_BIN){
  if(!godotBin)throw Error('society_godot_binary_required');
  const bridge=await startPerceptionBridge(),worker=launchPerceptionWorker(godotBin,bridge);
  try{await bridge.ready();}catch(error){await bridge.close();await worker.stop();throw Error('society_godot_start_failed: '+worker.output(),{cause:error});}
  return {perceive:bridge.perceive,navigate:bridge.navigate,stats:bridge.stats,output:worker.output,
    async close(){await bridge.close();await worker.stop();}};
}
