/** UUID v4. crypto.randomUUID only exists in secure contexts (https/localhost); a phone opening the
 * site over plain http on the LAN still has crypto.getRandomValues, so fall back to it. */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function' && window.isSecureContext) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Storage can be unavailable (private mode, blocked site data): never let it break the page.
export function readJSON<T>(store: 'local' | 'session', key: string, fallback: T): T {
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage;
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(store: 'local' | 'session', key: string, value: unknown): void {
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage;
    if (value === undefined || value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function formatDateTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || 'America/Bogota',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('es-CO');
  }
}

/** The customer's own recent orders on this device (tracking tokens are secrets kept only locally). */
export interface RecentOrder {
  token: string;
  code: string;
  total: string;
  created_at: string;
}

const RECENT_KEY = 'iglesia.recentOrders.v1';

export function getRecentOrders(): RecentOrder[] {
  const list = readJSON<RecentOrder[]>('local', RECENT_KEY, []);
  return Array.isArray(list) ? list.filter((o) => o && typeof o.token === 'string' && typeof o.code === 'string') : [];
}

export function addRecentOrder(o: RecentOrder): void {
  const list = getRecentOrders().filter((x) => x.token !== o.token);
  list.unshift(o);
  writeJSON('local', RECENT_KEY, list.slice(0, 10));
}

export function removeRecentOrder(token: string): void {
  writeJSON(
    'local',
    RECENT_KEY,
    getRecentOrders().filter((x) => x.token !== token),
  );
}

/** Absolute URL for an in-app path (respects the Vite base path). */
export function absoluteAppUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}${path}`;
}
