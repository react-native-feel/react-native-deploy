import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = '.mac-vnc-state.json';

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

export function getRunningCost(allocatedAt, ratePerHour = 6.5) {
  const hours = (Date.now() - new Date(allocatedAt).getTime()) / (1000 * 60 * 60);
  return (Math.max(hours, 24) * ratePerHour).toFixed(2);
}

export function getTimeRemaining(allocatedAt) {
  const elapsed = (Date.now() - new Date(allocatedAt).getTime()) / (1000 * 60 * 60);
  const remaining = Math.max(24 - elapsed, 0);
  const h = Math.floor(remaining);
  const m = Math.floor((remaining - h) * 60);
  return `${h}h ${m}m`;
}
