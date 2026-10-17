import { describe, expect, it } from 'vitest';

import {
  can,
  PERMISSION_KEYS,
  PERMISSIONS,
  rolePermissionSchema,
  SYSTEM_ROLES,
  widestScope,
} from './permissions';

describe('permissions', () => {
  it('every system role grant is a valid key with an allowed scope, no duplicates', () => {
    for (const [role, def] of Object.entries(SYSTEM_ROLES)) {
      const keys = def.permissions.map((p) => p.key);
      expect(new Set(keys).size, role).toBe(keys.length);
      for (const p of def.permissions)
        expect(rolePermissionSchema.safeParse(p).success, `${role} ${p.key}`).toBe(true);
    }
  });

  it('owner has every permission', () => {
    expect(SYSTEM_ROLES.owner.permissions.map((p) => p.key).sort()).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });

  it('payroll preparer cannot approve by default (maker-checker)', () => {
    expect(SYSTEM_ROLES.payroll_admin.permissions.some((p) => p.key === 'payroll.approve')).toBe(
      false,
    );
  });

  it('employee role is self-scoped only', () => {
    expect(SYSTEM_ROLES.employee.permissions.every((p) => p.scope === 'self')).toBe(true);
  });

  it('scope comparison', () => {
    expect(widestScope('self', 'team')).toBe('team');
    expect(widestScope('all', 'team')).toBe('all');
    expect(can({ 'leave.read': 'team' }, 'leave.read', 'self')).toBe(true);
    expect(can({ 'leave.read': 'team' }, 'leave.read', 'all')).toBe(false);
    expect(can({}, 'leave.read')).toBe(false);
  });

  it('rejects scopes a permission does not support', () => {
    expect(rolePermissionSchema.safeParse({ key: 'payroll.run', scope: 'self' }).success).toBe(
      false,
    );
    expect(PERMISSIONS['attendance.clock'].scopes).toEqual(['self']);
  });
});
