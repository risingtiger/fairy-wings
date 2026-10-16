// The Vite plugin that makes the game an installable web app that plays offline. On a production build
// it writes sw.js from src/sw.js, filling in the files to cache as it installs (the page, its code and
// styles, the manifest and icons) and a version that changes whenever any shipped file does (so the
// players' caches are replaced). The manifest and icons are in assets/; main.ts registers the worker.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHELL = ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

/** @returns {import('vite').Plugin} */
export function pwa(worker = 'src/sw.js') {
  let publicDir = '';
  return {
    name: 'pwa',
    apply: 'build',
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_, bundle) {
      const template = fs.readFileSync(worker, 'utf8'), hash = createHash('sha256').update(template);
      const built = Object.keys(bundle).filter((file) => /\.(js|css)$/.test(file)).sort();
      for (const file of built) {
        const out = bundle[file];
        hash.update(file).update(out.type === 'chunk' ? out.code : out.source);
      }
      const shipped = fs.readdirSync(publicDir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(publicDir, f)).isFile()).sort();
      for (const file of shipped) hash.update(file).update(fs.readFileSync(path.join(publicDir, file)));
      const source = template
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__SHELL__', JSON.stringify(['./', ...built, ...SHELL]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
