import { describe, expect, it } from 'vitest';
import { formatPolicy, getPath, parseJSON, parsePolicy, setPath } from './settings';

describe('paths', () => {
  it('reads nested values and tolerates missing parents', () => {
    expect(getPath({ smtpServer: { host: 'mail' } }, 'smtpServer.host')).toBe('mail');
    expect(getPath({}, 'smtpServer.host')).toBeUndefined();
  });

  it('treats everything after a slash as one key', () => {
    const rep = { attributes: { 'pkce.code.challenge.method': 'S256' } };
    expect(getPath(rep, 'attributes/pkce.code.challenge.method')).toBe('S256');
    expect(setPath(rep, 'attributes/pkce.code.challenge.method', 'plain').attributes).toEqual({
      'pkce.code.challenge.method': 'plain',
    });
  });

  it('copies on write and creates missing parents', () => {
    const rep = { a: { b: 1 }, keep: {} };
    const next = setPath(rep, 'a.c.d', 2);
    expect(next).toEqual({ a: { b: 1, c: { d: 2 } }, keep: {} });
    expect(rep.a).toEqual({ b: 1 });
    expect(next.keep).toBe(rep.keep);
  });
});

describe('password policy', () => {
  it('round-trips the string format', () => {
    const policy = 'length(8) and digits(1) and notUsername(undefined) and notEmail';
    const entries = parsePolicy(policy);
    expect(entries[0]).toEqual({ id: 'length', value: '8' });
    expect(entries[3]).toEqual({ id: 'notEmail', value: '' });
    expect(formatPolicy(entries)).toBe(policy);
  });

  it('treats no policy as empty', () => {
    expect(parsePolicy(undefined)).toEqual([]);
    expect(formatPolicy([])).toBe('');
  });
});

describe('parseJSON', () => {
  it('reports errors instead of throwing', () => {
    expect(parseJSON('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJSON('{').ok).toBe(false);
  });
});
