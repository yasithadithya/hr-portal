import { z } from 'zod';

/**
 * Typed settings registry (PLAN.md Phase 3 `settings` table). Every key has a Zod schema and a
 * default; the API rejects unknown keys and invalid values.
 */
export const SETTINGS = {
  'security.mfa_required': {
    label: 'Require two-factor authentication for everyone',
    group: 'security',
    schema: z.boolean(),
    default: false,
  },
  'branding.primary_color': {
    label: 'Brand colour',
    group: 'branding',
    schema: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #1d4ed8')
      .nullable(),
    default: null,
  },
  'documents.expiry_warning_days': {
    label: 'Warn about expiring employee documents this many days ahead',
    group: 'documents',
    schema: z.number().int().min(1).max(365),
    default: 30,
  },
  'attendance.ot_requires_approval': {
    label: 'Overtime must be approved before payroll pays it',
    group: 'attendance',
    schema: z.boolean(),
    default: false,
  },
  'attendance.branch_check': {
    label:
      'When a branch has both a geofence and an IP allowlist, a clock-in must pass (either / both)',
    group: 'attendance',
    schema: z.enum(['either', 'both']),
    default: 'either',
  },
  'payroll.payslip_password': {
    label: 'Password-protect payslip PDFs with',
    group: 'payroll',
    schema: z.enum(['none', 'nic', 'dob']),
    default: 'none',
  },
  'payroll.allow_self_approval': {
    label: 'Let the person who prepared a payroll also approve it (very small teams only)',
    group: 'payroll',
    schema: z.boolean(),
    default: false,
  },
  'payroll.variance_threshold_percent': {
    label: 'Highlight net pay changes above this % versus last month',
    group: 'payroll',
    schema: z.number().min(0).max(1000),
    default: 10,
  },
  'payroll.require_locked_attendance': {
    label: 'Payroll uses only locked attendance months',
    group: 'payroll',
    schema: z.boolean(),
    default: true,
  },
  'notifications.reminder_days': {
    label: 'Remind HR this many days before probation or contract end dates',
    group: 'notifications',
    schema: z.number().int().min(1).max(120),
    default: 14,
  },
} as const satisfies Record<
  string,
  { label: string; group: string; schema: z.ZodType; default: unknown }
>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const settingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export const settingsMapSchema = z.object(
  Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].schema])) as {
    [K in SettingKey]: (typeof SETTINGS)[K]['schema'];
  },
);

export function settingDefaults(): SettingsMap {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as SettingsMap;
}
