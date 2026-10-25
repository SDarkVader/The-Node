import { expect,it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain Node credential utility has no declaration file
import {sealCredential,unsealCredential} from '../scripts/credential-envelope.mjs';
it('encrypts only the requested Anthropic credential and authenticates its transfer',()=>{
  const keys=generateKeyPairSync('x25519'),pub=keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),priv=keys.privateKey.export({format:'der',type:'pkcs8'});
  const value='sk-ant-TEST_ONLY_not_a_real_key',envelope=sealCredential(Buffer.from('OTHER_SECRET=do-not-transfer\nANTHROPIC_API_KEY="'+value+'"\n'),pub);
  expect(JSON.stringify(envelope)).not.toContain(value);expect(JSON.stringify(envelope)).not.toContain('do-not-transfer');
  expect(unsealCredential(envelope,priv).toString()).toBe('ANTHROPIC_API_KEY='+value+'\n');
  const corrupted={...envelope,tag:Buffer.alloc(16).toString('base64')};expect(()=>unsealCredential(corrupted,priv)).toThrow();
  const wrong=generateKeyPairSync('x25519').privateKey.export({format:'der',type:'pkcs8'});expect(()=>unsealCredential(envelope,wrong)).toThrow('recipient_mismatch');
});
it('diagnoses crypto without reading a credential and returns safe errors for bad input',()=>{
  const pair=generateKeyPairSync('x25519'),pub=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const path=fileURLToPath(new URL('../scripts/credential-envelope.mjs',import.meta.url));
  const check=spawnSync(process.execPath,[path,'check',pub],{encoding:'utf8'});expect(check.status).toBe(0);
  expect(JSON.parse(check.stdout)).toMatchObject({checkPassed:true,credentialRead:false,providerCalls:0});
  const input='DO_NOT_ECHO_THIS_INVALID_INPUT';const failed=spawnSync(process.execPath,[path,'seal',pub,'/tmp/nonexistent-credential-folder/unused.json'],{encoding:'utf8',input});
  expect(failed.status).toBe(1);expect(failed.stderr).not.toContain(input);expect(JSON.parse(failed.stderr)).toMatchObject({stage:'seal',code:'credential_entry_invalid',credentialPrinted:false});
});
