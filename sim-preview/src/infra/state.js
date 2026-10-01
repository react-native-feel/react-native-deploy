import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = '.rn-preview-state.json';

export function loadState(dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function saveState(state, dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function clearState(dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  if (existsSync(path)) unlinkSync(path);
}
