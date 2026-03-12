import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function buildAllocateCommand(az, instanceType, region) {
  const family = instanceType.split('.')[0];
  return `aws ec2 allocate-hosts --instance-family ${family} --availability-zone ${az} --quantity 1 --region ${region} --output json`;
}

export function buildDescribeCommand(hostId, region) {
  return `aws ec2 describe-hosts --host-ids ${hostId} --region ${region} --output json`;
}

export function buildReleaseCommand(hostId, region) {
  return `aws ec2 release-hosts --host-ids ${hostId} --region ${region} --output json`;
}

async function getAvailableAz(instanceType, region) {
  const output = execSync(`aws ec2 describe-instance-type-offerings --location-type availability-zone --filters "Name=instance-type,Values=${instanceType}" --region ${region} --output json`, { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const azs = data.InstanceTypeOfferings.map(o => o.Location);
  if (azs.length === 0) throw new Error(`Instance type ${instanceType} is not available in ${region}. Try a different region.`);
  return azs[0];
}

export async function allocateDedicatedHost(instanceType, region) {
  const az = await getAvailableAz(instanceType, region);
  logger.info(`Allocating Dedicated Host in ${az}...`);
  const output = execSync(buildAllocateCommand(az, instanceType, region), { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const hostId = data.HostIds[0];
  logger.info(`Dedicated Host allocated: ${hostId}. Waiting for availability...`);
  let attempts = 0;
  const maxAttempts = 60;
  while (attempts < maxAttempts) {
    const descOutput = execSync(buildDescribeCommand(hostId, region), { encoding: 'utf-8', stdio: 'pipe' });
    const descData = JSON.parse(descOutput);
    const state = descData.Hosts[0].State;
    if (state === 'available') { logger.success(`Dedicated Host ${hostId} is available`); return { hostId, az }; }
    if (state === 'released' || state === 'declined') throw new Error(`Dedicated Host ${hostId} entered unexpected state: ${state}`);
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for Dedicated Host ${hostId} to become available`);
}

export async function releaseDedicatedHost(hostId, region) {
  logger.info(`Releasing Dedicated Host ${hostId}...`);
  try {
    execSync(buildReleaseCommand(hostId, region), { stdio: 'pipe' });
    logger.success(`Dedicated Host ${hostId} released`);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('within its minimum allocation period')) { logger.warn(`Cannot release host ${hostId} yet — still within the 24-hour minimum allocation period.`); return false; }
    throw err;
  }
  return true;
}

export async function getHostState(hostId, region) {
  try {
    const output = execSync(buildDescribeCommand(hostId, region), { encoding: 'utf-8', stdio: 'pipe' });
    const data = JSON.parse(output);
    return data.Hosts[0];
  } catch { return null; }
}
