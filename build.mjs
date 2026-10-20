import { build } from 'esbuild';
import { mkdir, copyFile, chmod, access } from 'node:fs/promises';
// Some npm versions unpack node-pty's macOS spawn helper without its executable bit.
const helper = `node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`;
try { await access(helper); await chmod(helper, 0o755); } catch {}
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], format: 'esm', bundle: true, minify: true, outfile: 'dist/app.js', sourcemap: true });
await copyFile('src/index.html', 'dist/index.html');
