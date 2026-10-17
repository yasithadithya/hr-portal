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

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Modules not built yet render disabled. */
  ready: boolean;
}

// Visibility will come from the user's permissions in Phase 2.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, ready: true },
  { href: '/me', label: 'My HR', icon: UserRound, ready: true },
  { href: '/employees', label: 'Employees', icon: Users, ready: false },
  { href: '/leave', label: 'Leave', icon: CalendarDays, ready: false },
  { href: '/attendance', label: 'Attendance', icon: Clock, ready: false },
  { href: '/payroll', label: 'Payroll', icon: Wallet, ready: false },
  { href: '/settings', label: 'Settings', icon: Settings, ready: false },
];
