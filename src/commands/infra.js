import { loadConfig } from '../config/loader.js';
import { loadState, saveState, clearState, isWithinMinAllocation, getTimeRemaining, getRunningCost } from '../infra/state.js';
import { ensureKeyPair } from '../infra/key-pair.js';
import { ensureSecurityGroup, updateSecurityGroupIp } from '../infra/security-group.js';
import { allocateDedicatedHost, releaseDedicatedHost, getHostState } from '../infra/dedicated-host.js';
import { launchInstance, terminateInstance, getInstanceState } from '../infra/instance.js';
import { listCustomAmis, deleteCustomAmi } from '../infra/ami.js';
import { logger } from '../utils/logger.js';
import { confirm, select } from '../utils/prompts.js';
import { verifyPrerequisites } from '../utils/prerequisites.js';

export async function infraUp(options = {}) {
  await verifyPrerequisites();
  const config = loadConfig();
  const { region, instanceType, keyPairName, securityGroupName, customAmiId } = config.aws;

  // Check for existing instance
  const existingState = loadState();
  if (existingState) {
    const instance = await getInstanceState(existingState.instanceId, region);
    if (instance && instance.State.Name === 'running') {
      logger.info(`Instance already running: ${existingState.instanceId} at ${existingState.publicIp}`);
      return existingState;
    }
    logger.warn('Previous instance no longer running. Cleaning up...');
    clearState();
  }

  // Cost warning
  if (!options.nonInteractive) {
    const proceed = await confirm(
      'This will allocate a Dedicated Host with a 24-hour minimum commitment (~$6.50/hr, ~$156 USD). Continue?',
      false
    );
    if (!proceed) {
      logger.info('Cancelled');
      return null;
    }
  }

  // Provision
  const keyPath = await ensureKeyPair(keyPairName, region);
  const sgId = await ensureSecurityGroup(securityGroupName, region);
  const { hostId, az } = await allocateDedicatedHost(instanceType, region);
  const { instanceId, publicIp, amiId } = await launchInstance({
    instanceType,
    keyName: keyPairName,
    sgId,
    hostId,
    region,
    customAmiId,
  });

  const state = {
    hostId,
    instanceId,
    publicIp,
    allocatedAt: new Date().toISOString(),
    region,
    amiId,
    keyPath,
    sgId,
  };
  saveState(state);

  logger.success(`Infrastructure ready. Instance: ${instanceId} at ${publicIp}`);
  return state;
}

export async function infraDown(options = {}) {
  const state = loadState();
  if (!state) {
    logger.info('No active infrastructure found');
    return;
  }

  const { region } = state;

  // Cost warning if within minimum allocation
  if (isWithinMinAllocation(state.allocatedAt)) {
    const remaining = getTimeRemaining(state.allocatedAt);
    logger.warn(`Still within 24-hour minimum allocation. Time remaining: ${remaining}`);
    logger.warn('You will be charged for the full 24 hours regardless of early termination.');
    if (!options.nonInteractive) {
      const proceed = await confirm('Proceed with teardown?', false);
      if (!proceed) return;
    }
  }

  // Terminate instance
  await terminateInstance(state.instanceId, region);

  // Release host
  await releaseDedicatedHost(state.hostId, region);

  clearState();
  logger.success('Infrastructure torn down');
}

export async function infraStatus() {
  const state = loadState();
  if (!state) {
    logger.info('No active infrastructure');
    return;
  }

  const instance = await getInstanceState(state.instanceId, state.region);
  const host = await getHostState(state.hostId, state.region);

  logger.info(`Host:       ${state.hostId} (${host?.State || 'unknown'})`);
  logger.info(`Instance:   ${state.instanceId} (${instance?.State?.Name || 'unknown'})`);
  logger.info(`IP:         ${state.publicIp}`);
  logger.info(`Region:     ${state.region}`);
  logger.info(`Allocated:  ${state.allocatedAt}`);

  if (isWithinMinAllocation(state.allocatedAt)) {
    logger.info(`24h remaining: ${getTimeRemaining(state.allocatedAt)}`);
  } else {
    logger.info('24h minimum period has passed — teardown will not incur additional cost');
  }
  logger.info(`Running cost: ~$${getRunningCost(state.allocatedAt)}`);
}

export async function infraAmiList() {
  const config = loadConfig();
  const amis = await listCustomAmis(config.aws.region);

  if (amis.length === 0) {
    logger.info('No custom AMIs found');
    return;
  }

  for (const ami of amis) {
    logger.info(`${ami.amiId}  ${ami.name}  ${ami.state}  ${ami.createdAt}`);
  }
}

export async function infraAmiDelete(options = {}) {
  const config = loadConfig();
  const amis = await listCustomAmis(config.aws.region);

  if (amis.length === 0) {
    logger.info('No custom AMIs to delete');
    return;
  }

  const amiId = options.amiId || await select(
    'Select AMI to delete:',
    amis.map(a => ({ name: `${a.amiId} (${a.name})`, value: a.amiId }))
  );

  await deleteCustomAmi(amiId, config.aws.region);
}

export async function infraUpdateIp() {
  const state = loadState();
  if (!state) {
    logger.error('No active infrastructure. Run "rn-deploy infra up" first.');
    return;
  }

  await updateSecurityGroupIp(state.sgId, state.region);
}
