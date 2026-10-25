// Local credential transfer only. No network or API calls. Plaintext is never logged.
// seal <recipient SPKI base64> <NEW envelope.json> [private .env file]
// unseal <private PKCS8 file> <envelope.json> <NEW private .env file>
import { generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync,
  randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SCHEMA='node-credential-envelope-v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function credential(bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16384)throw Error('credential_bounds');
  const text=bytes.toString('utf8').trim();let value=text;
  if(!text.startsWith('sk-ant-')){
    const lines=text.split(/\r?\n/).filter(line=>/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=/.test(line));
    if(lines.length!==1)throw Error('credential_entry_invalid');
    value=lines[0].slice(lines[0].indexOf('=')+1).trim();
    if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  }
  if(value.length>512||!/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(value))throw Error('credential_entry_invalid');
  return Buffer.from('ANTHROPIC_API_KEY='+value+'\n');
}
export function sealCredential(bytes,recipientBase64){
  const recipientBytes=Buffer.from(recipientBase64,'base64'),recipient=createPublicKey({key:recipientBytes,format:'der',type:'spki'});
  if(recipient.asymmetricKeyType!=='x25519')throw Error('credential_recipient_invalid');
  const ephemeral=generateKeyPairSync('x25519'),salt=randomBytes(32),iv=randomBytes(12);
  const header={schema:SCHEMA,recipientSha256:sha(recipientBytes),ephemeralPublicKey:ephemeral.publicKey.export({format:'der',type:'spki'}).toString('base64'),salt:salt.toString('base64'),iv:iv.toString('base64')};
  const secret=diffieHellman({privateKey:ephemeral.privateKey,publicKey:recipient});
  const key=Buffer.from(hkdfSync('sha256',secret,salt,Buffer.from(SCHEMA),32));
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const plain=credential(bytes);
  try {const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return{...header,ciphertext:encrypted.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
  finally{plain.fill(0);key.fill(0);secret.fill(0);}
}
export function unsealCredential(envelope,privateBytes){
  if(envelope.schema!==SCHEMA||Object.keys(envelope).sort().join(',')!=='ciphertext,ephemeralPublicKey,iv,recipientSha256,salt,schema,tag')throw Error('credential_envelope_invalid');
  const privateKey=createPrivateKey({key:privateBytes,format:'der',type:'pkcs8'}),recipient=createPublicKey(privateKey).export({format:'der',type:'spki'});
  if(privateKey.asymmetricKeyType!=='x25519'||sha(recipient)!==envelope.recipientSha256)throw Error('credential_recipient_mismatch');
  const ephemeral=createPublicKey({key:Buffer.from(envelope.ephemeralPublicKey,'base64'),format:'der',type:'spki'});
  const salt=Buffer.from(envelope.salt,'base64'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64'),encrypted=Buffer.from(envelope.ciphertext,'base64');
  if(salt.length!==32||iv.length!==12||tag.length!==16||encrypted.length>16384)throw Error('credential_envelope_invalid');
  const secret=diffieHellman({privateKey,publicKey:ephemeral}),key=Buffer.from(hkdfSync('sha256',secret,salt,Buffer.from(SCHEMA),32));
  const {ciphertext:_,tag:__,...header}=envelope,decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(JSON.stringify(header)));decipher.setAuthTag(tag);
  try{return credential(Buffer.concat([decipher.update(encrypted),decipher.final()]))}finally{key.fill(0);secret.fill(0);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [mode,a,b,c]=process.argv.slice(2);
    if(mode==='seal'&&a&&b&&process.argv.length<=6){
      const input=c?readFileSync(c):readFileSync(0),envelope=sealCredential(input,a);input.fill(0);
      writeFileSync(b,JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify({sealed:true,recipientSha256:envelope.recipientSha256}));
    }else if(mode==='unseal'&&a&&b&&c&&process.argv.length===6){
      const stat=lstatSync(a);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('credential_private_key_permissions');
      const encrypted=readFileSync(b);if(encrypted.length>32768)throw Error('credential_envelope_bounds');
      const output=resolve(c);mkdirSync(dirname(output),{recursive:true,mode:0o700});
      if(realpathSync(dirname(output))!==dirname(output))throw Error('credential_destination_symlink');
      const plain=unsealCredential(JSON.parse(encrypted),readFileSync(a));
      try{writeFileSync(output,plain,{flag:'wx',mode:0o600});}finally{plain.fill(0);}
      console.log(JSON.stringify({saved:true,variable:'ANTHROPIC_API_KEY',mode:'0600',dispatches:0}));
    }else throw Error('credential_transfer_arguments');
  }catch{console.error('Credential transfer failed. No credential was printed; check arguments, key, envelope integrity and whether the destination already exists.');process.exitCode=1;}
}
