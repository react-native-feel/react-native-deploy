import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildAwsCommand, parseAwsJson } from '../../src/utils/aws.js';

describe('aws utils', () => {
  it('buildAwsCommand constructs correct command', () => {
    const cmd = buildAwsCommand('ec2', 'describe-instances', {
      region: 'us-east-1',
      filters: 'Name=instance-type,Values=mac2.metal',
    });
    assert.strictEqual(
      cmd,
      'aws ec2 describe-instances --region us-east-1 --filters Name=instance-type,Values=mac2.metal --output json'
    );
  });

  it('buildAwsCommand handles no options', () => {
    const cmd = buildAwsCommand('sts', 'get-caller-identity', {});
    assert.strictEqual(cmd, 'aws sts get-caller-identity --output json');
  });

  it('parseAwsJson parses valid JSON', () => {
    const result = parseAwsJson('{"HostId": "h-123"}');
    assert.deepStrictEqual(result, { HostId: 'h-123' });
  });

  it('parseAwsJson throws on invalid JSON', () => {
    assert.throws(() => parseAwsJson('not json'), /Failed to parse AWS CLI output/);
  });
});
