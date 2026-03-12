import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateConfig } from '../../src/config/schema.js';

describe('validateConfig', () => {
  const validConfig = {
    cli: { version: '1.0.0' },
    aws: {
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      keyPairName: 'rn-deploy-key',
      securityGroupName: 'rn-deploy-sg',
      customAmiId: null,
      nodeVersion: '20',
      xcodeVersion: '16',
    },
    asc: {
      keyId: 'ABC123',
      issuerId: 'DEF456',
      privateKeyPath: '~/.appstoreconnect/AuthKey.p8',
    },
    repo: { url: 'git@github.com:user/app.git', branch: 'main' },
    build: {
      production: {
        buildType: 'expo',
        scheme: 'MyApp',
        buildConfiguration: 'Release',
        env: {},
      },
    },
    submit: {
      production: {
        testFlightGroups: ['Internal Testers'],
        whatToTest: '',
      },
    },
  };

  it('accepts valid config', () => {
    const errors = validateConfig(validConfig);
    assert.deepStrictEqual(errors, []);
  });

  it('rejects missing aws.region', () => {
    const bad = JSON.parse(JSON.stringify(validConfig));
    delete bad.aws.region;
    const errors = validateConfig(bad);
    assert.ok(errors.some(e => e.includes('aws.region')));
  });

  it('rejects missing asc.keyId', () => {
    const bad = JSON.parse(JSON.stringify(validConfig));
    delete bad.asc.keyId;
    const errors = validateConfig(bad);
    assert.ok(errors.some(e => e.includes('asc.keyId')));
  });

  it('rejects invalid buildType', () => {
    const bad = JSON.parse(JSON.stringify(validConfig));
    bad.build.production.buildType = 'invalid';
    const errors = validateConfig(bad);
    assert.ok(errors.some(e => e.includes('buildType')));
  });

  it('accepts config without submit section', () => {
    const noSubmit = JSON.parse(JSON.stringify(validConfig));
    delete noSubmit.submit;
    const errors = validateConfig(noSubmit);
    assert.deepStrictEqual(errors, []);
  });
});
