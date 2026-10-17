import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION } from './index';

describe('payroll engine placeholder', () => {
  it('exports a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
