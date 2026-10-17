import { z } from 'zod';

/**
 * Authorization = permission + scope (CLAUDE.md Hard Rule 7).
 * Permission keys are `module.action`; scope is `self | team | all`.
 * `team` = the manager's recursive reports_to subtree (plus themselves).
 */

export const SCOPES = ['self', 'team', 'all'] as const;
export type Scope = (typeof SCOPES)[number];
export const scopeSchema = z.enum(SCOPES);

const SCOPE_RANK: Record<Scope, number> = { self: 0, team: 1, all: 2 };

export function widestScope(a: Scope, b: Scope): Scope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export function scopeCovers(granted: Scope, required: Scope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

interface PermissionDef {
  label: string;
  /** Scopes that make sense for this permission (UI only offers these). */
  scopes: readonly Scope[];
}

const ALL: readonly Scope[] = ['all'];
const ANY: readonly Scope[] = SCOPES;

export const PERMISSIONS = {
  'employees.read': { label: 'View employees', scopes: ANY },
  'employees.create': { label: 'Hire / add employees', scopes: ALL },
  'employees.update': { label: 'Edit employees', scopes: ANY },
  'employees.archive': { label: 'Archive employees', scopes: ALL },
  'org.manage': { label: 'Manage branches, departments, grades', scopes: ALL },
  'documents.read': { label: 'View employee documents', scopes: ANY },
  'documents.manage': { label: 'Upload / delete employee documents', scopes: ANY },
  'leave.read': { label: 'View leave', scopes: ANY },
  'leave.apply': { label: 'Apply for leave', scopes: ANY },
  'leave.approve': { label: 'Approve leave', scopes: ['team', 'all'] },
  'leave.manage': { label: 'Manage leave types, policies, balances', scopes: ALL },
  'attendance.read': { label: 'View attendance', scopes: ANY },
  'attendance.clock': { label: 'Clock in / out', scopes: ['self'] },
  'attendance.regularize': { label: 'Request attendance corrections', scopes: ANY },
  'attendance.approve': { label: 'Approve attendance / OT', scopes: ['team', 'all'] },
  'attendance.manage': { label: 'Manage shifts, rosters, periods', scopes: ALL },
  'payroll.read': { label: 'View payroll runs', scopes: ALL },
  'payroll.run': { label: 'Prepare and calculate payroll', scopes: ALL },
  'payroll.approve': { label: 'Approve payroll', scopes: ALL },
  'payroll.lock': { label: 'Lock / mark payroll paid', scopes: ALL },
  'payroll.configure': { label: 'Configure pay components and statutory settings', scopes: ALL },
  'payslips.read': { label: 'View payslips', scopes: ANY },
  'settings.manage': { label: 'Manage company settings', scopes: ALL },
  'users.manage': { label: 'Invite users and manage roles', scopes: ALL },
  'reports.read': { label: 'View reports', scopes: ['team', 'all'] },
  'audit.read': { label: 'View audit log', scopes: ALL },
} as const satisfies Record<string, PermissionDef>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];
export const permissionKeySchema = z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);

/** Effective permissions of a user: key → widest granted scope. Serialisable for the web app. */
export type PermissionMap = Partial<Record<PermissionKey, Scope>>;

export function can(perms: PermissionMap, key: PermissionKey, required: Scope = 'self'): boolean {
  const granted = perms[key];
  return granted !== undefined && scopeCovers(granted, required);
}

export const rolePermissionSchema = z
  .object({ key: permissionKeySchema, scope: scopeSchema })
  .refine((p) => (PERMISSIONS[p.key].scopes as readonly Scope[]).includes(p.scope), {
    message: 'Scope not allowed for this permission',
  });
export type RolePermission = z.infer<typeof rolePermissionSchema>;

const grant = (scope: Scope, ...keys: PermissionKey[]): RolePermission[] =>
  keys.map((key) => ({ key, scope }));

const EMPLOYEE_SELF = grant(
  'self',
  'employees.read',
  'documents.read',
  'leave.read',
  'leave.apply',
  'attendance.read',
  'attendance.clock',
  'attendance.regularize',
  'payslips.read',
);

/** Seeded system roles. Editable copies can be made; system roles themselves are not editable. */
export const SYSTEM_ROLES: Record<
  'owner' | 'hr_admin' | 'payroll_admin' | 'manager' | 'employee',
  { name: string; description: string; permissions: RolePermission[] }
> = {
  owner: {
    name: 'Owner',
    description: 'Full access, including users and billing contacts',
    permissions: PERMISSION_KEYS.map((key) => ({
      key,
      scope: PERMISSIONS[key].scopes.includes('all' as never) ? 'all' : 'self',
    })),
  },
  hr_admin: {
    name: 'HR admin',
    description: 'Employees, organisation, leave, attendance and settings',
    permissions: [
      ...grant(
        'all',
        'employees.read',
        'employees.create',
        'employees.update',
        'employees.archive',
        'org.manage',
        'documents.read',
        'documents.manage',
        'leave.read',
        'leave.apply',
        'leave.approve',
        'leave.manage',
        'attendance.read',
        'attendance.regularize',
        'attendance.approve',
        'attendance.manage',
        'settings.manage',
        'users.manage',
        'reports.read',
        'audit.read',
      ),
      ...grant('self', 'attendance.clock', 'payslips.read'),
    ],
  },
  payroll_admin: {
    name: 'Payroll admin',
    description: 'Prepares payroll; approval needs a different person',
    permissions: [
      ...grant(
        'all',
        'employees.read',
        'leave.read',
        'attendance.read',
        'payroll.read',
        'payroll.run',
        'payroll.lock',
        'payroll.configure',
        'payslips.read',
        'reports.read',
      ),
      ...grant(
        'self',
        'leave.apply',
        'attendance.clock',
        'attendance.regularize',
        'documents.read',
      ),
    ],
  },
  manager: {
    name: 'Manager',
    description: 'Sees and approves for their team',
    permissions: [
      ...EMPLOYEE_SELF.filter(
        (p) => !['employees.read', 'leave.read', 'attendance.read'].includes(p.key),
      ),
      ...grant(
        'team',
        'employees.read',
        'leave.read',
        'leave.approve',
        'attendance.read',
        'attendance.approve',
        'reports.read',
      ),
    ],
  },
  employee: {
    name: 'Employee',
    description: 'Self-service only',
    permissions: EMPLOYEE_SELF,
  },
};

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;
