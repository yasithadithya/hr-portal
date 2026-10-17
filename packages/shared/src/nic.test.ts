import { describe, expect, it } from 'vitest';

import { isValidNic, parseNic } from './nic';

describe('NIC', () => {
  it('parses an old-format male NIC and converts it to the new format', () => {
    // 1985, day 032 → 1 February
    expect(parseNic('850322937v')).toEqual({
      format: 'old',
      normalised: '850322937V',
      newFormat: '198503202937',
      suggestedDob: '1985-02-01',
      suggestedGender: 'male',
    });
  });

  it('parses an old-format female NIC (+500)', () => {
    // 1990, day 532-500 = 32 → 1 February
    expect(parseNic('905321234X')).toMatchObject({
      suggestedDob: '1990-02-01',
      suggestedGender: 'female',
    });
  });

  it('parses a new-format NIC', () => {
    // 2001, day 060 → 29 Feb counted, so 1 March is day 61; day 60 = 29 Feb (2001 not leap → invalid)
    expect(parseNic('200106100123')).toMatchObject({
      format: 'new',
      suggestedDob: '2001-03-01',
      suggestedGender: 'male',
    });
    expect(parseNic('200006000123')).toMatchObject({ suggestedDob: '2000-02-29' });
    expect(parseNic('200106000123')).toBeNull();
  });

  it('counts February as 29 days for every year', () => {
    // day 366 = 31 December
    expect(parseNic('199536612345')?.suggestedDob).toBe('1995-12-31');
    expect(parseNic('199586612345')).toMatchObject({
      suggestedDob: '1995-12-31',
      suggestedGender: 'female',
    });
  });

  it('rejects malformed and impossible numbers', () => {
    for (const bad of [
      '',
      '12345678V',
      '8503229371',
      '85032293AV',
      '1985032029371',
      '853672937V',
      '850002937V',
      '199500012345',
    ]) {
      expect(isValidNic(bad), bad).toBe(false);
    }
  });

  it('accepts spaces and dashes', () => {
    expect(parseNic('1985 032 02937')?.normalised).toBe('198503202937');
  });
});
