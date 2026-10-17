/**
 * Sri Lankan National Identity Card numbers.
 *  - Old format: 9 digits + V or X, e.g. 853202937V  (YY DDD SSSC)
 *  - New format: 12 digits, e.g. 198532002937      (YYYY DDD SSSSC)
 * DDD is the day of the year of birth, +500 for women. The day count treats February as
 * always having 29 days. Derived DOB/gender are only *suggestions* shown to HR (PLAN.md Phase 4),
 * never written automatically: some cards are known to be inconsistent.
 */

export interface NicInfo {
  format: 'old' | 'new';
  /** Normalised: upper-case, no spaces. */
  normalised: string;
  /** Equivalent 12-digit number (old-format cards only map to 19xx births). */
  newFormat: string;
  suggestedDob: string | null;
  suggestedGender: 'male' | 'female' | null;
}

const OLD = /^(\d{2})(\d{3})(\d{3})(\d)([VX])$/;
const NEW = /^(\d{4})(\d{3})(\d{4})(\d)$/;
// February counted as 29 days, as on the cards.
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function dobFromDayNumber(year: number, day: number): string | null {
  if (day < 1 || day > 366) return null;
  let remaining = day;
  for (let m = 0; m < 12; m++) {
    if (remaining <= MONTH_DAYS[m]!) {
      if (m === 1 && remaining === 29 && !isLeap(year)) return null;
      return `${year}-${String(m + 1).padStart(2, '0')}-${String(remaining).padStart(2, '0')}`;
    }
    remaining -= MONTH_DAYS[m]!;
  }
  return null;
}

export function normaliseNic(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Parses an NIC. Returns null if the format is wrong or the encoded birth date is impossible. */
export function parseNic(input: string): NicInfo | null {
  const nic = normaliseNic(input);
  let year: number;
  let dayCode: number;
  let newFormat: string;
  let format: NicInfo['format'];

  const old = OLD.exec(nic);
  const neu = NEW.exec(nic);
  if (old) {
    format = 'old';
    year = 1900 + Number(old[1]);
    dayCode = Number(old[2]);
    newFormat = `${year}${old[2]}0${old[3]}${old[4]}`;
  } else if (neu) {
    format = 'new';
    year = Number(neu[1]);
    dayCode = Number(neu[2]);
    newFormat = nic;
  } else {
    return null;
  }

  const female = dayCode > 500;
  const day = female ? dayCode - 500 : dayCode;
  const dob = dobFromDayNumber(year, day);
  if (!dob) return null;
  return {
    format,
    normalised: nic,
    newFormat,
    suggestedDob: dob,
    suggestedGender: female ? 'female' : 'male',
  };
}

export function isValidNic(input: string): boolean {
  return parseNic(input) !== null;
}
