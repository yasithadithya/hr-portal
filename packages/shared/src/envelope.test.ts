import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { envelopeSchema, fail, ok } from './envelope';

describe('envelope', () => {
  const schema = envelopeSchema(z.object({ n: z.number() }));

  it('parses success and failure', () => {
    expect(schema.parse(ok({ n: 1 }))).toEqual({ success: true, data: { n: 1 } });
    expect(schema.parse(fail('NOT_FOUND', 'nope'))).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'nope' },
    });
  });

  it('rejects unknown error codes', () => {
    expect(() => schema.parse({ success: false, error: { code: 'WAT', message: 'x' } })).toThrow();
  });
});
