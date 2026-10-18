import { z } from 'zod';

import { businessDateSchema } from '../time/index';

/** Every event the app notifies about (PLAN.md Phase 8). Labels drive the preferences screen. */
export const NOTIFICATION_EVENTS = {
  'leave.submitted': 'A leave request needs my approval',
  'leave.decided': 'My leave request was approved or rejected',
  'attendance.regularization_submitted': 'An attendance correction needs my approval',
  'attendance.regularization_decided': 'My attendance correction was decided',
  'payroll.payslip_published': 'My payslip is ready',
  'profile.change_submitted': 'A profile change needs review (HR)',
  'profile.change_decided': 'My profile change was decided',
  'reminder.document_expiring': 'An employee document is about to expire (HR)',
  'reminder.probation_ending': 'An employee’s probation is ending (HR)',
  'reminder.contract_ending': 'An employee’s contract is ending (HR)',
} as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

export const notificationSchema = z.object({
  id: z.uuid(),
  event: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  unread: z.number().int(),
  items: z.array(notificationSchema),
});

export const preferenceSchema = z.object({
  event: z.enum(NOTIFICATION_EVENT_KEYS as [NotificationEvent, ...NotificationEvent[]]),
  label: z.string(),
  email: z.boolean(),
  push: z.boolean(),
});
export type NotificationPreference = z.infer<typeof preferenceSchema>;
export const preferencesUpdateSchema = z.object({
  preferences: z
    .array(preferenceSchema.pick({ event: true, email: true, push: true }))
    .min(1)
    .max(50),
});

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

// ── Profile change requests ─────────────────────────────────────────────────
export const PROFILE_FIELDS = {
  personal: ['preferredName', 'maritalStatus', 'religion', 'nationality'],
  contact: ['personalEmail', 'mobile', 'address'],
  bank: ['bankName', 'bankBranch', 'bankAccountNo', 'bankAccountName'],
} as const;
export type ProfileSection = keyof typeof PROFILE_FIELDS;

const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
});

export const profileChangeInputSchema = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('personal'),
    values: z
      .object({
        preferredName: z.string().trim().max(100).nullable(),
        maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed', 'other']).nullable(),
        religion: z.string().trim().max(60).nullable(),
        nationality: z.string().trim().max(60).nullable(),
      })
      .partial(),
    note: z.string().trim().max(300).nullable().optional(),
  }),
  z.object({
    section: z.literal('contact'),
    values: z
      .object({
        personalEmail: z.email().nullable(),
        mobile: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ]{7,15}$/, 'Use a phone number like +94 77 123 4567')
          .nullable(),
        address: addressSchema,
      })
      .partial(),
    note: z.string().trim().max(300).nullable().optional(),
  }),
  z.object({
    section: z.literal('bank'),
    values: z
      .object({
        bankName: z.string().trim().max(100).nullable(),
        bankBranch: z.string().trim().max(100).nullable(),
        bankAccountNo: z
          .string()
          .trim()
          .regex(/^[0-9]{4,20}$/, 'Digits only')
          .nullable(),
        bankAccountName: z.string().trim().max(100).nullable(),
      })
      .partial(),
    note: z.string().trim().max(300).nullable().optional(),
  }),
]);
export type ProfileChangeInput = z.input<typeof profileChangeInputSchema>;

export const profileChangeSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  section: z.enum(['personal', 'contact', 'bank']),
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  note: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type ProfileChange = z.infer<typeof profileChangeSchema>;

// ── Self-service home & approvals ───────────────────────────────────────────
export const approvalsSummarySchema = z.object({
  leave: z.number().int(),
  regularizations: z.number().int(),
  overtime: z.number().int(),
  profileChanges: z.number().int(),
  total: z.number().int(),
});
export type ApprovalsSummary = z.infer<typeof approvalsSummarySchema>;

export const pendingOtSchema = z.object({
  dayId: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  date: businessDateSchema,
  otMinutes: z.number().int(),
});
