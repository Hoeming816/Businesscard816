// Copies the single-file demo build to preview/cardfile-preview.html.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'preview'), { recursive: true });
copyFileSync(resolve(root, 'dist-preview/index.html'), resolve(root, 'preview/cardfile-preview.html'));
console.log('wrote preview/cardfile-preview.html');
