// Dotted paths into Keycloak representations, e.g. "smtpServer.host" or
// "attributes.frontendUrl". Keys that themselves contain dots (Keycloak has
// attributes like "pkce.code.challenge.method") are written with a slash:
// "attributes/pkce.code.challenge.method".

function splitPath(path: string): string[] {
  const slash = path.indexOf('/');
  if (slash >= 0) return [path.slice(0, slash), path.slice(slash + 1)];
  return path.split('.');
}

export function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of splitPath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = splitPath(path);
  const root = { ...(obj as Record<string, unknown>) };
  let cur = root;
  keys.slice(0, -1).forEach((key) => {
    const next = cur[key];
    cur[key] = next !== null && typeof next === 'object' ? { ...(next as object) } : {};
    cur = cur[key] as Record<string, unknown>;
  });
  cur[keys[keys.length - 1]!] = value;
  return root as T;
}

// Keycloak's password policy is one string: "length(8) and digits(1) and notUsername".
export interface PolicyEntry {
  id: string;
  value: string;
}

export function parsePolicy(policy: string | undefined): PolicyEntry[] {
  if (!policy) return [];
  return policy
    .split(/\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^([^()]+)\((.*)\)$/.exec(part);
      return m ? { id: m[1]!, value: m[2]! } : { id: part, value: '' };
    });
}

export function formatPolicy(entries: PolicyEntry[]): string {
  return entries.map((e) => (e.value === '' ? e.id : `${e.id}(${e.value})`)).join(' and ');
}

// parseJSONObject validates what an administrator typed into a JSON editor.
export function parseJSON(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Некорректный JSON' };
  }
}
