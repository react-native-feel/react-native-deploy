import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function allocateDedicatedHost(region, az) {
  logger.info('Allocating Dedicated Host (mac2.metal)...');

  if (!az) {
    const azResult = execSync(
      `aws ec2 describe-availability-zones --region ${region} --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    az = JSON.parse(azResult).AvailabilityZones[0].ZoneName;
  }

  const result = execSync(
    `aws ec2 allocate-hosts --instance-type mac2.metal --quantity 1 --availability-zone ${az} --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const hostId = JSON.parse(result).HostIds[0];
  logger.success(`Dedicated Host allocated: ${hostId}`);
  return hostId;
}

export async function waitForHost(hostId, region, maxAttempts = 60) {
  const spinner = logger.startSpinner('Waiting for Dedicated Host to become available...');

  for (let i = 0; i < maxAttempts; i++) {
    const result = execSync(
      `aws ec2 describe-hosts --host-ids ${hostId} --region ${region} --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const state = JSON.parse(result).Hosts[0].State;

    if (state === 'available') {
      logger.stopSpinner(true, 'Dedicated Host available');
      return;
    }
    if (state === 'released' || state === 'released-permanent-failure') {
      logger.stopSpinner(false, `Host entered state: ${state}`);
      throw new Error(`Dedicated Host failed: ${state}`);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  logger.stopSpinner(false, 'Timeout waiting for host');
  throw new Error('Timeout waiting for Dedicated Host');
}

export function releaseDedicatedHost(hostId, region) {
  logger.info(`Releasing Dedicated Host ${hostId}...`);
  try {
    execSync(
      `aws ec2 release-hosts --host-ids ${hostId} --region ${region}`,
      { stdio: 'pipe' }
    );
    logger.success('Dedicated Host released');
  } catch (err) {
    logger.warn(`Failed to release host: ${err.message}`);
  }
}
