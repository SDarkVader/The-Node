import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

/** Lazy trusted-parent reader. Construction never reads a secret; the live transport calls it only after its protected gate.
 * This is not an environment loader. It does not mutate process.env or pass a credential into the game-host process.
 */
export function providerCredentialFile(workspace: string, target = '.env.local'): () => string {
  const root = resolve(workspace), path = resolve(root, target);
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!normalize(path).startsWith(normalize(root + sep))) throw Error('provider_credential_path');
  return () => {
    try {
      const file = lstatSync(path), parent = lstatSync(dirname(path));
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size > 16_384 || !parent.isDirectory() || parent.isSymbolicLink() ||
        normalize(realpathSync(dirname(path))) !== normalize(dirname(path)) || normalize(realpathSync(root)) !== normalize(root) ||
        process.platform !== 'win32' && ((file.mode & 0o077) !== 0 || typeof process.getuid === 'function' && file.uid !== process.getuid())) throw Error();
      const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => /^\s*(?:export\s+)?OPENAI_API_KEY\s*=/.test(line));
      if (lines.length !== 1) throw Error();
      let value = lines[0]!.slice(lines[0]!.indexOf('=') + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (value.length > 512 || !/^sk-[A-Za-z0-9_-]{8,}$/.test(value)) throw Error();
      return value;
    } catch { throw Error('provider_credential_unavailable'); }
  };
}
