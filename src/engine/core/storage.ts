// Settings remembered per browser. Storage can be unavailable (private windows), so it's best effort.

export function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function save(key: string, value: string | boolean): void {
  try { localStorage.setItem(key, typeof value === 'boolean' ? (value ? '1' : '0') : value); } catch { /* not remembered */ }
}

export const loadFlag = (key: string) => load(key) === '1';
