import type { Plugin } from 'vite';

/** Writes the offline service worker on production builds (see pwa.mjs). */
export function pwa(worker?: string): Plugin;
