import { z } from 'zod';

import { permissionKeySchema, rolePermissionSchema, scopeSchema } from '../permissions';

export const APP_USER_STATUSES = ['invited', 'active', 'disabled'] as const;

export const roleRefSchema = z.object({ id: z.uuid(), key: z.string(), name: z.string() });

export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    status: z.enum(APP_USER_STATUSES),
    employeeId: z.uuid().nullable(),
  }),
  employee: z.object({ id: z.uuid(), name: z.string(), employeeNo: z.string() }).nullable(),
  roles: z.array(roleRefSchema),
  permissions: z.partialRecord(permissionKeySchema, scopeSchema),
  tenant: z.object({ slug: z.string(), name: z.string(), timezone: z.string() }),
});
export type Me = z.infer<typeof meSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  status: z.enum(APP_USER_STATUSES),
  employeeId: z.uuid().nullable(),
  lastLoginAt: z.string().nullable(),
  invitedAt: z.string().nullable(),
  roles: z.array(roleRefSchema),
});
export type User = z.infer<typeof userSchema>;

export const inviteUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  roleIds: z.array(z.uuid()).min(1, 'Pick at least one role'),
  employeeId: z.uuid().nullable().optional(),
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const updateUserSchema = z
  .object({
    roleIds: z.array(z.uuid()).min(1).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    employeeId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const roleSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  userCount: z.number().int(),
  permissions: z.array(rolePermissionSchema),
});
export type Role = z.infer<typeof roleSchema>;

const rolePermissionsInput = z
  .array(rolePermissionSchema)
  .refine((ps) => new Set(ps.map((p) => p.key)).size === ps.length, 'Duplicate permission');

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  /** Copy permissions from this role (usually a system role), then apply `permissions` if given. */
  copyFromRoleId: z.uuid().optional(),
  permissions: rolePermissionsInput.optional(),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: rolePermissionsInput.optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const auditQuerySchema = z.object({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  actorUserId: z.uuid().optional(),
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditEntrySchema = z.object({
  id: z.uuid(),
  actorUserId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  at: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  /** Pass as `cursor` to get the next (older) page. */
  nextCursor: z.string().nullable(),
});

export const employeeSummarySchema = z.object({
  id: z.uuid(),
  employeeNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  workEmail: z.string().nullable(),
  reportsToId: z.uuid().nullable(),
  status: z.string(),
});
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
