import {
  CalendarDays,
  Clock,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { PermissionKey, Scope } from '@hr/shared';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Modules not built yet render disabled. */
  ready: boolean;
  /** Shown if the user holds any of these (at `minScope`). Omit = everyone signed in. */
  anyOf?: PermissionKey[];
  minScope?: Scope;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, ready: true },
  { href: '/me', label: 'My HR', icon: UserRound, ready: true },
  {
    href: '/employees',
    label: 'Employees',
    icon: Users,
    ready: true,
    anyOf: ['employees.read'],
    minScope: 'team',
  },
  {
    href: '/leave',
    label: 'Leave',
    icon: CalendarDays,
    ready: true,
    anyOf: ['leave.apply', 'leave.approve', 'leave.manage'],
  },
  {
    href: '/attendance',
    label: 'Attendance',
    icon: Clock,
    ready: false,
    anyOf: ['attendance.approve', 'attendance.manage'],
  },
  { href: '/payroll', label: 'Payroll', icon: Wallet, ready: false, anyOf: ['payroll.read'] },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    ready: true,
    anyOf: ['settings.manage', 'users.manage', 'audit.read'],
  },
];
