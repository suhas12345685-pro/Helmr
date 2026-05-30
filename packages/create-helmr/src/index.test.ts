import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatBanner, runRequiredCommand } from './index.js';

describe('create-helmr installer helpers', () => {
  it('reports required command failures instead of silently continuing', () => {
    assert.throws(
      () => runRequiredCommand('node -e "process.exit(23)"', { silent: true }),
      /Command failed: node -e "process.exit\(23\)"/,
    );
  });

  it('renders onboarding copy without mojibake glyph artifacts', () => {
    const banner = formatBanner('create-helmr - Helmr Onboarding Wizard');

    assert.equal(banner.includes('â'), false);
    assert.equal(banner.includes('create-helmr - Helmr Onboarding Wizard'), true);
  });
});
