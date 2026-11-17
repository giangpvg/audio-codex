'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const result = await esbuild.build({
    entryPoints: ['src/extension.js'], outfile: 'dist/extension.js', bundle: true,
    platform: 'node', target: 'node18', format: 'cjs', sourcemap: false,
    external: ['vscode', 'bufferutil', 'utf-8-validate'], metafile: true, legalComments: 'inline',
  });
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const marker = input.lastIndexOf('node_modules/');
    if (marker < 0) continue;
    const name = /^((?:@[^/]+\/)?[^/]+)/.exec(input.slice(marker + 'node_modules/'.length))[1];
    packages.add(input.slice(0, marker) + 'node_modules/' + name);
  }
  const notices = ['Third-party libraries bundled with Giọng Việt cho Codex.\n'];
  for (const root of [...packages].sort()) {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const license = (await fs.readdir(root)).find(file => /^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
    if (!license) throw new Error(`Missing license for bundled dependency: ${pkg.name}`);
    notices.push(`\n--- ${pkg.name} ${pkg.version} (${pkg.license}) ---\n${await fs.readFile(path.join(root, license), 'utf8')}`);
  }
  await fs.writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n').replace(/\r\n/g, '\n'));
  console.log('Bundled extension and third-party licenses.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
