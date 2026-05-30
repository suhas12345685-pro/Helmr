import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { getHelmrPaths } from './paths.js';

test('Helmr paths default to the local user state directory', () => {
  const paths = getHelmrPaths({}, 'C:/Users/Test');

  assert.equal(paths.rootDir, join('C:/Users/Test', '.helmr'));
  assert.equal(paths.dataDir, join('C:/Users/Test', '.helmr', 'data'));
  assert.equal(paths.configDir, join('C:/Users/Test', '.helmr', 'config'));
  assert.equal(paths.auditDir, join('C:/Users/Test', '.helmr', 'data', 'audit'));
});

test('Helmr paths honor explicit enterprise state directories', () => {
  const paths = getHelmrPaths(
    {
      HELMR_DATA_DIR: 'D:/helmr/data',
      HELMR_CONFIG_DIR: 'D:/helmr/config',
      HELMR_AUDIT_DIR: 'D:/helmr/audit',
    },
    'C:/Users/Test',
  );

  assert.equal(paths.rootDir, join('C:/Users/Test', '.helmr'));
  assert.equal(paths.dataDir, 'D:/helmr/data');
  assert.equal(paths.configDir, 'D:/helmr/config');
  assert.equal(paths.auditDir, 'D:/helmr/audit');
});
