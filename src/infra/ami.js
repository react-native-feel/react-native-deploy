import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function buildCreateImageCommand(instanceId, name, region) {
  return `aws ec2 create-image --instance-id ${instanceId} --name "${name}" --description "rn-deploy custom AMI with build tools" --region ${region} --output json`;
}

export function buildDescribeImagesCommand(region) {
  return `aws ec2 describe-images --owners self --filters "Name=name,Values=rn-deploy-*" --region ${region} --output json`;
}

export function buildDeregisterCommand(amiId, region) {
  return `aws ec2 deregister-image --image-id ${amiId} --region ${region}`;
}

export async function createCustomAmi(instanceId, region) {
  const name = `rn-deploy-custom-${Date.now()}`;
  logger.info(`Creating custom AMI "${name}" from instance ${instanceId}...`);
  const output = execSync(buildCreateImageCommand(instanceId, name, region), { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const amiId = data.ImageId;
  logger.info(`AMI ${amiId} creation started. Waiting for it to become available...`);
  execSync(`aws ec2 wait image-available --image-ids ${amiId} --region ${region}`, { encoding: 'utf-8', timeout: 600000 });
  logger.success(`Custom AMI ready: ${amiId}`);
  return amiId;
}

export async function listCustomAmis(region) {
  const output = execSync(buildDescribeImagesCommand(region), { encoding: 'utf-8' });
  const data = JSON.parse(output);
  return data.Images.map(img => ({ amiId: img.ImageId, name: img.Name, createdAt: img.CreationDate, state: img.State }));
}

export async function deleteCustomAmi(amiId, region) {
  logger.info(`Deregistering AMI ${amiId}...`);
  try {
    const output = execSync(`aws ec2 describe-images --image-ids ${amiId} --region ${region} --output json`, { encoding: 'utf-8', stdio: 'pipe' });
    const data = JSON.parse(output);
    const snapshots = data.Images[0]?.BlockDeviceMappings?.filter(b => b.Ebs?.SnapshotId).map(b => b.Ebs.SnapshotId) || [];
    execSync(buildDeregisterCommand(amiId, region), { stdio: 'pipe' });
    for (const snapId of snapshots) { execSync(`aws ec2 delete-snapshot --snapshot-id ${snapId} --region ${region}`, { stdio: 'pipe' }); logger.debug(`Deleted snapshot ${snapId}`); }
  } catch { execSync(buildDeregisterCommand(amiId, region), { stdio: 'pipe' }); }
  logger.success(`AMI ${amiId} deleted`);
}
