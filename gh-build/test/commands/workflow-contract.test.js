import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowTemplate } from '../../src/commands/workflow.js';
import { buildInputs } from '../../src/commands/build.js';
import { resolveProfile } from '../../src/config/profiles.js';
import { SECRET_NAMES } from '../../src/config/schema.js';

/**
 * The CLI and the workflow talk over workflow_dispatch inputs. GitHub silently
 * drops inputs the workflow never declared, so a rename on either side would
 * otherwise show up as a mystifying build failure.
 */
function declaredInputs(yaml) {
  const block = yaml.match(/workflow_dispatch:\n\s+inputs:\n([\s\S]*?)\njobs:/);
  assert.ok(block, 'workflow has a workflow_dispatch inputs block');
  return new Set([...block[1].matchAll(/^ {6}([a-z_]+):$/gm)].map((m) => m[1]));
}

const yaml = workflowTemplate();

const sent = Object.keys(
  buildInputs({
    config: { ios: {}, android: {} },
    profile: resolveProfile({ production: {} }, 'production'),
    profileName: 'production',
    platform: 'all',
    options: {},
  })
);

test('every input the CLI sends is declared by the workflow', () => {
  const declared = declaredInputs(yaml);
  const undeclared = sent.filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, []);
});

test('every input the workflow declares is sent by the CLI', () => {
  const unsent = [...declaredInputs(yaml)].filter((name) => !sent.includes(name));
  assert.deepEqual(unsent, []);
});

test('every secret name the config declares is read by the workflow', () => {
  const names = Object.values(SECRET_NAMES).flatMap((group) => Object.values(group));
  const missing = names.filter((name) => !yaml.includes(`secrets.${name}`));
  assert.deepEqual(missing, []);
});

test('the workflow uploads both an iOS and an Android artifact', () => {
  assert.match(yaml, /name: ios-\$\{\{ inputs\.profile \}\}/);
  assert.match(yaml, /name: android-\$\{\{ inputs\.profile \}\}/);
});
