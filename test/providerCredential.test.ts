import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync, linkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { providerCredentialFile } from '../src/agent/providerCredential.js';
import { sendLiveResponses } from '../src/agent/responsesTransport.js';
import { participant, cleanupResponses } from './fixtures/responsesFixture.js';
import { root } from './fixtures/accountingFixture.js';
afterEach(cleanupResponses);
const fake = 'sk-fixture-only-not-a-provider-key';

describe('lazy provider credential file reader, disposable fake files only', () => {
  it('does not read at construction and returns only the fake selected assignment', () => {
    const directory = root(), getKey = providerCredentialFile(directory); // File deliberately absent until after construction.
    writeFileSync(join(directory, '.env.local'), `UNRELATED_SETTING=not-returned\nOPENAI_API_KEY=${fake}\n`, { mode: 0o600 });
    expect(getKey()).toBe(fake);
  });
  it.each([`'${fake}'`, `"${fake}"`])('supports the confirmed helper-compatible quoted form %s', value => {
    const directory = root(); writeFileSync(join(directory, '.env.local'), `OPENAI_API_KEY=${value}\r\n`, { mode: 0o600 });
    expect(providerCredentialFile(directory)()).toBe(fake);
  });
  it.each(['', 'OPENAI_API_KEY=bad', `OPENAI_API_KEY=${fake}\nOPENAI_API_KEY=${fake}`, `OPENAI_API_KEY=${fake} # ambiguous`])('rejects missing/malformed/duplicate assignments without echoing content', content => {
    const directory = root(); writeFileSync(join(directory, '.env.local'), content, { mode: 0o600 });
    expect(() => providerCredentialFile(directory)()).toThrow('provider_credential_unavailable');
  });
  it('rejects escape paths, hardlinks and linked parent directories', () => {
    const directory = root(); expect(() => providerCredentialFile(directory, '../outside.env')).toThrow('provider_credential_path');
    writeFileSync(join(directory, '.env.local'), `OPENAI_API_KEY=${fake}`, { mode: 0o600 }); linkSync(join(directory, '.env.local'), join(root(), 'alias.env'));
    expect(() => providerCredentialFile(directory)()).toThrow('provider_credential_unavailable');
    const alias = join(root(), 'alias'); symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => providerCredentialFile(alias)()).toThrow('provider_credential_unavailable');
  });
  it('does not invoke even the fake file reader through the closed live path', async () => {
    let reads = 0; const getKey = providerCredentialFile(root());
    await expect(sendLiveResponses(participant().request, () => { reads++; return getKey(); }, { proxyUrl: 'http://uncontacted.invalid/', caPem: '' }, new AbortController().signal))
      .rejects.toThrow('recovery_accounting_unresolved'); expect(reads).toBe(0);
  });
});
