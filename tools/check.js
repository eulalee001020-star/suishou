// Static checks that need no browser: the manifest points at files that
// exist, every script parses, and pages only load files that are present.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const need = (path, why) => {
  if (!existsSync(join(root, path))) problems.push(`${why}: ${path} is missing`);
};

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
for (const icon of Object.values(manifest.icons ?? {})) need(icon, 'icon');
need(manifest.action.default_popup, 'popup');
need(manifest.options_ui.page, 'options page');
need(manifest.background.service_worker, 'service worker');
for (const script of manifest.content_scripts.flatMap((entry) => entry.js)) need(script, 'content script');
for (const resource of manifest.web_accessible_resources.flatMap((entry) => entry.resources)) {
  need(resource, 'web accessible resource');
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(root, 'src'));
for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`syntax: ${file}\n${error.stderr}`);
  }
  // Relative imports must resolve.
  for (const [, target] of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
    if (!existsSync(resolve(dirname(file), target))) problems.push(`import: ${file} -> ${target}`);
  }
}
for (const file of files.filter((f) => f.endsWith('.html'))) {
  for (const [, target] of readFileSync(file, 'utf8').matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(resolve(dirname(file), target))) problems.push(`page: ${file} -> ${target}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: manifest, ${files.length} source files`);
