import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const DEFAULT_AMI_FILTERS = [
  { Name: 'name', Values: ['amzn-ec2-macos-14*'] },
  { Name: 'architecture', Values: ['arm64_mac'] },
  { Name: 'state', Values: ['available'] },
];

export function findLatestMacAmi(region) {
  const filters = DEFAULT_AMI_FILTERS
    .map((f) => `Name=${f.Name},Values=${f.Values.join(',')}`)
    .join(' ');

  const result = execSync(
    `aws ec2 describe-images --owners amazon --filters ${filters} --query "sort_by(Images, &CreationDate)[-1].ImageId" --region ${region} --output text`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const amiId = result.trim();
  if (!amiId || amiId === 'None') throw new Error('No macOS AMI found');
  logger.debug(`Latest macOS AMI: ${amiId}`);
  return amiId;
}

export function launchInstance({ hostId, amiId, sgId, keyName, region }) {
  logger.info('Launching EC2 Mac instance...');

  const result = execSync(
    `aws ec2 run-instances --image-id ${amiId} --instance-type mac2.metal --key-name ${keyName} --security-group-ids ${sgId} --placement "HostId=${hostId}" --count 1 --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const instance = JSON.parse(result).Instances[0];
  const instanceId = instance.InstanceId;
  logger.success(`Instance launched: ${instanceId}`);
  return instanceId;
}

export function waitForInstance(instanceId, region) {
  const spinner = logger.startSpinner('Waiting for instance to be running...');

  execSync(
    `aws ec2 wait instance-running --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe', timeout: 600000 }
  );
  logger.stopSpinner(true, 'Instance running');

  logger.startSpinner('Waiting for status checks...');
  execSync(
    `aws ec2 wait instance-status-ok --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe', timeout: 600000 }
  );
  logger.stopSpinner(true, 'Status checks passed');
}

export function getInstancePublicIp(instanceId, region) {
  const result = execSync(
    `aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].PublicIpAddress" --region ${region} --output text`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  return result.trim();
}

export function terminateInstance(instanceId, region) {
  logger.info(`Terminating instance ${instanceId}...`);
  execSync(
    `aws ec2 terminate-instances --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe' }
  );
  logger.success('Instance terminated');
}
