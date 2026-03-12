import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function buildRunCommand({ amiId, instanceType, keyName, sgId, hostId, region }) {
  return `aws ec2 run-instances --image-id ${amiId} --instance-type ${instanceType} --key-name ${keyName} --security-group-ids ${sgId} --placement "HostId=${hostId}" --region ${region} --output json`;
}

export function buildTerminateCommand(instanceId, region) {
  return `aws ec2 terminate-instances --instance-ids ${instanceId} --region ${region} --output json`;
}

async function getLatestMacAmi(region) {
  const output = execSync(`aws ec2 describe-images --owners amazon --filters "Name=name,Values=amzn-ec2-macos-*" "Name=architecture,Values=arm64_mac" --query "Images | sort_by(@, &CreationDate) | [-1]" --region ${region} --output json`, { encoding: 'utf-8' });
  const ami = JSON.parse(output);
  if (!ami || !ami.ImageId) throw new Error(`No macOS AMI found in ${region}`);
  logger.debug(`Using AMI: ${ami.ImageId} (${ami.Name})`);
  return ami.ImageId;
}

export async function launchInstance({ instanceType, keyName, sgId, hostId, region, customAmiId }) {
  const amiId = customAmiId || await getLatestMacAmi(region);
  logger.info('Launching EC2 Mac instance...');
  const output = execSync(buildRunCommand({ amiId, instanceType, keyName, sgId, hostId, region }), { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const instanceId = data.Instances[0].InstanceId;
  logger.info(`Instance ${instanceId} launched. Waiting for it to be running...`);
  execSync(`aws ec2 wait instance-running --instance-ids ${instanceId} --region ${region}`, { encoding: 'utf-8', timeout: 600000 });
  logger.info('Waiting for status checks to pass...');
  execSync(`aws ec2 wait instance-status-ok --instance-ids ${instanceId} --region ${region}`, { encoding: 'utf-8', timeout: 600000 });
  const descOutput = execSync(`aws ec2 describe-instances --instance-ids ${instanceId} --region ${region} --output json`, { encoding: 'utf-8' });
  const descData = JSON.parse(descOutput);
  const publicIp = descData.Reservations[0].Instances[0].PublicIpAddress;
  if (!publicIp) throw new Error(`Instance ${instanceId} has no public IP. Check your VPC/subnet settings.`);
  logger.success(`Instance ready: ${instanceId} at ${publicIp}`);
  return { instanceId, publicIp, amiId };
}

export async function terminateInstance(instanceId, region) {
  logger.info(`Terminating instance ${instanceId}...`);
  execSync(buildTerminateCommand(instanceId, region), { stdio: 'pipe' });
  execSync(`aws ec2 wait instance-terminated --instance-ids ${instanceId} --region ${region}`, { encoding: 'utf-8', timeout: 300000 });
  logger.success(`Instance ${instanceId} terminated`);
}

export async function getInstanceState(instanceId, region) {
  try {
    const output = execSync(`aws ec2 describe-instances --instance-ids ${instanceId} --region ${region} --output json`, { encoding: 'utf-8', stdio: 'pipe' });
    const data = JSON.parse(output);
    return data.Reservations[0]?.Instances[0] || null;
  } catch { return null; }
}
