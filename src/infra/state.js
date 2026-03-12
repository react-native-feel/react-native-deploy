import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STATE_FILENAME = '.rn-deploy-state.json';
const MIN_ALLOCATION_HOURS = 24;

export function loadState(dir = process.cwd()) {
  const statePath = join(resolve(dir), STATE_FILENAME);
  if (!existsSync(statePath)) return null;
  try { return JSON.parse(readFileSync(statePath, 'utf-8')); } catch { return null; }
}

export function saveState(state, dir = process.cwd()) {
  const statePath = join(resolve(dir), STATE_FILENAME);
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

export function clearState(dir = process.cwd()) {
  const statePath = join(resolve(dir), STATE_FILENAME);
  if (existsSync(statePath)) unlinkSync(statePath);
}

export function isWithinMinAllocation(allocatedAt) {
  const elapsed = Date.now() - new Date(allocatedAt).getTime();
  return elapsed / (1000 * 60 * 60) < MIN_ALLOCATION_HOURS;
}

export function getTimeRemaining(allocatedAt) {
  const remaining = (MIN_ALLOCATION_HOURS * 60 * 60 * 1000) - (Date.now() - new Date(allocatedAt).getTime());
  if (remaining <= 0) return '0h 0m';
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export function getRunningCost(allocatedAt, ratePerHour = 6.5) {
  const hours = (Date.now() - new Date(allocatedAt).getTime()) / (1000 * 60 * 60);
  return (Math.max(hours, MIN_ALLOCATION_HOURS) * ratePerHour).toFixed(2);
}
