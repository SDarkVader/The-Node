import { describe, expect, it } from 'vitest';
import { isKnown } from '../src/engine/player.js';

describe('isKnown — binary identity resolution', () => {
  it('returns known when the subject is in the observer\'s known set', () => {
    expect(isKnown('sable', new Set(['wren', 'sable']))).toBe('known');
  });

  it('returns unknown when the subject is absent from the known set', () => {
    expect(isKnown('idris', new Set(['wren', 'sable']))).toBe('unknown');
  });

  it('returns unknown for an empty known set — no default trust', () => {
    expect(isKnown('wren', new Set())).toBe('unknown');
  });

  it('is not symmetric by construction — only reflects the observer\'s own set', () => {
    // wren knowing sable says nothing about whether sable knows wren; that's a
    // different observer's set entirely, not modeled here.
    const wrenKnows = new Set(['sable']);
    const idrisKnows = new Set<string>();
    expect(isKnown('sable', wrenKnows)).toBe('known');
    expect(isKnown('wren', idrisKnows)).toBe('unknown');
  });
});
