/** Trusted preparer CLI. Git checks are read-only; no provider or inference child is started. */
import { readFileSync,realpathSync } from 'node:fs';
import { dirname,resolve,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkSocietyLaunch,prepareSocietyLaunch,validateSocietyLaunchConfig } from '../src/society/launch.js';

try{
  const {values}=parseArgs({options:{config:{type:'string'},check:{type:'boolean',default:false}}});
  if(!values.config)throw Error('society_launch_config_required');
  const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),configPath=resolve(values.config);
  const rel=relative(realpathSync(repositoryRoot),realpathSync(configPath));
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('society_launch_private_config_required');
  const bytes=readFileSync(configPath);if(bytes.length>65536)throw Error('society_launch_config_bounds');
  const config:unknown=JSON.parse(bytes.toString('utf8'));validateSocietyLaunchConfig(config);
  const environment={repositoryRoot};
  const result=values.check?checkSocietyLaunch(config,environment):prepareSocietyLaunch(config,environment);
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  const code=error instanceof Error&&/^[a-z_]{1,128}$/.test(error.message)?error.message:'society_launch_prepare_failed';
  process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;
}
