import { MODULE_KEYS, type ModuleKey } from '../../utils/permissions';

export interface HrSubTab {
  id: string;
  label: string;
}

export interface HrTabGroup {
  id: string;
  label: string;
  subTabs?: HrSubTab[];
}

// Two-level navigation for the HR module. Groups without subTabs render a single view.
export const HR_TAB_GROUPS: HrTabGroup[] = [
  { id: 'dashboard', label: 'Dashboard' },
  {
    id: 'people',
    label: 'People',
    subTabs: [
      { id: 'employees', label: 'Employees' },
      { id: 'documents', label: 'Documents' },
      { id: 'onboarding', label: 'On/Offboarding' },
    ],
  },
  {
    id: 'time',
    label: 'Time',
    subTabs: [
      { id: 'attendance', label: 'Attendance' },
      { id: 'leaves', label: 'Leaves' },
      { id: 'balances', label: 'Balances' },
      { id: 'holidays', label: 'Holidays' },
    ],
  },
  {
    id: 'pay',
    label: 'Pay',
    subTabs: [
      { id: 'payroll', label: 'Payroll' },
      { id: 'structures', label: 'Salary Structures' },
    ],
  },
  {
    id: 'talent',
    label: 'Talent',
    subTabs: [
      { id: 'performance', label: 'Performance' },
      { id: 'training', label: 'Training' },
    ],
  },
  { id: 'announcements', label: 'Announcements' },
  {
    id: 'settings',
    label: 'Settings',
    subTabs: [
      { id: 'org', label: 'Departments & Titles' },
      { id: 'leavetypes', label: 'Leave Types' },
    ],
  },
  { id: 'myhr', label: 'My HR' },
];

/**
 * The permission sub-module behind each HR view. "dashboard" needs read on any HR sub-module;
 * "myhr" (self-service) is open to everyone.
 */
export const HR_TAB_MODULE: Record<string, ModuleKey> = {
  employees: MODULE_KEYS.hrEmployees,
  documents: MODULE_KEYS.hrEmployees,
  onboarding: MODULE_KEYS.hrEmployees,
  org: MODULE_KEYS.hrEmployees,
  attendance: MODULE_KEYS.hrAttendance,
  leaves: MODULE_KEYS.hrLeave,
  balances: MODULE_KEYS.hrLeave,
  holidays: MODULE_KEYS.hrLeave,
  leavetypes: MODULE_KEYS.hrLeave,
  payroll: MODULE_KEYS.hrPayroll,
  structures: MODULE_KEYS.hrPayroll,
  performance: MODULE_KEYS.hrPerformance,
  training: MODULE_KEYS.hrTraining,
  announcements: MODULE_KEYS.hrAnnouncements,
};

export const findGroupForSubTab = (subTabId: string): HrTabGroup | undefined =>
  HR_TAB_GROUPS.find(g => g.id === subTabId || g.subTabs?.some(s => s.id === subTabId));

/**
 * The HR groups this user may see. Anyone who can read any HR area gets the admin views
 * (`isHrAdmin`); everyone else only gets "My HR" self-service.
 */
export function visibleHrGroups(can: (key: ModuleKey) => boolean, isHrAdmin: boolean): HrTabGroup[] {
  const isTabAllowed = (id: string) =>
    id === 'myhr' ? true : id === 'dashboard' ? isHrAdmin : !!HR_TAB_MODULE[id] && can(HR_TAB_MODULE[id]);
  return HR_TAB_GROUPS
    .map((g): HrTabGroup => (g.subTabs ? { ...g, subTabs: g.subTabs.filter(st => isTabAllowed(st.id)) } : g))
    .filter(g => (g.subTabs ? g.subTabs.length > 0 : isTabAllowed(g.id)));
}

/**
 * Resolves ?tab= to the view to render. A group id (e.g. "people") opens its first sub-tab; an unknown
 * or forbidden tab falls back to the default (HR dashboard for HR admins, "My HR" for everyone else).
 */
export function resolveHrTab(groups: HrTabGroup[], requested: string | null, isHrAdmin: boolean): { tab: string; group: HrTabGroup } {
  const findGroup = (tabId: string) => groups.find(g => g.id === tabId || g.subTabs?.some(st => st.id === tabId));
  const first = groups[0];
  const defaultTab = isHrAdmin && first ? (first.subTabs ? first.subTabs[0].id : first.id) : 'myhr';
  const wanted = requested || defaultTab;
  const group = findGroup(wanted);
  if (!group) return { tab: defaultTab, group: findGroup(defaultTab) ?? first };
  return { tab: group.subTabs && group.id === wanted ? group.subTabs[0].id : wanted, group };
}

/** Display label of an HR view id, e.g. "leaves" -> "Leaves". */
export const hrTabLabel = (tabId: string): string => {
  for (const g of HR_TAB_GROUPS) {
    if (g.id === tabId) return g.label;
    const sub = g.subTabs?.find(st => st.id === tabId);
    if (sub) return sub.label;
  }
  return tabId;
};
