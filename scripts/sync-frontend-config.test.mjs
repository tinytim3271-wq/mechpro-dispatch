#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'src/shared/config.js');
const infraOutputs = join(root, 'infra/cdk-outputs.json');
const backup = readFileSync(configPath, 'utf8');

try {
  writeFileSync(infraOutputs, JSON.stringify({
    MechProAuthStack: {
      UserPoolId: 'us-east-1_TESTPOOL',
      UserPoolClientId: 'test-client-id',
    },
    MechProApiStack: {
      ApiUrl: 'https://api.example.com/',
    },
  }, null, 2));

  const sync = spawnSync(process.execPath, ['scripts/sync-frontend-config.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(sync.status, 0, sync.stderr || sync.stdout);

  const generated = readFileSync(configPath, 'utf8');
  assert.match(generated, /us-east-1_TESTPOOL/);
  assert.match(generated, /test-client-id/);
  assert.match(generated, /https:\/\/api\.example\.com/);
  console.log('sync-frontend-config tests passed');
} finally {
  writeFileSync(configPath, backup);
  if (existsSync(infraOutputs)) rmSync(infraOutputs);
}
