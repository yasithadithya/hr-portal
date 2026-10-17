import { useMemo, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hrTabLabel, resolveHrTab, visibleHrGroups } from './hrTabs';
import { PageHeader, Tabs } from '@/ui';
import { HR_KEYS } from '../../utils/permissions';

import HRDashboard from './HRDashboard';
import EmployeeList from './EmployeeList';
import EmployeeDocuments from './EmployeeDocuments';
import OnboardingView from './OnboardingView';
import AttendanceView from './AttendanceView';
import LeaveManagement from './LeaveManagement';
import LeaveBalancesView from './LeaveBalancesView';
import HolidaysManagement from './HolidaysManagement';
import PayrollDashboard from './PayrollDashboard';
import SalaryStructures from './SalaryStructures';
import PerformanceView from './PerformanceView';
import TrainingView from './TrainingView';
import Announcements from './Announcements';
import DepartmentsJobTitles from './DepartmentsJobTitles';
import LeaveTypesManagement from './LeaveTypesManagement';
import MyHRView from './MyHRView';

const CONTENT: Record<string, (basePath: string) => ReactElement> = {
  dashboard: () => <HRDashboard />,
  employees: (basePath) => <EmployeeList basePath={basePath} />,
  documents: () => <EmployeeDocuments />,
  onboarding: () => <OnboardingView />,
  attendance: (basePath) => <AttendanceView basePath={basePath} />,
  leaves: (basePath) => <LeaveManagement basePath={basePath} />,
  balances: () => <LeaveBalancesView />,
  holidays: () => <HolidaysManagement />,
  payroll: (basePath) => <PayrollDashboard basePath={basePath} />,
  structures: () => <SalaryStructures />,
  performance: () => <PerformanceView />,
  training: () => <TrainingView />,
  announcements: () => <Announcements />,
  org: () => <DepartmentsJobTitles />,
  leavetypes: () => <LeaveTypesManagement />,
  myhr: () => <MyHRView />,
};

export default function HRModulePage({ currentModule }: { currentModule: any }) {
  const { module } = useParams<{ module?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, canAny } = useAuth();

  const basePath = `/${module || 'hr'}`;
  // Anyone who can read at least one HR area sees the admin views; everyone else gets self-service only.
  const isHrAdmin = canAny(HR_KEYS);

  const groups = useMemo(() => visibleHrGroups(key => can(key), isHrAdmin), [can, isHrAdmin]);
  const { tab: activeTab, group } = resolveHrTab(groups, searchParams.get('tab'), isHrAdmin);
  const setTab = (tabId: string) => setSearchParams({ tab: tabId });

  const render = CONTENT[activeTab] || CONTENT.myhr;
  const hrName = currentModule?.name || 'HR';

  // Areas are picked in the sidebar; the page only switches between siblings (e.g. Attendance / Leaves / Holidays).
  return (
    <div className="animate-in">
      <PageHeader
        breadcrumbs={[
          { label: hrName, href: basePath },
          ...(group.subTabs ? [{ label: group.label }] : []),
          { label: hrTabLabel(activeTab) },
        ]}
        title={activeTab === 'dashboard' ? 'Human resources' : hrTabLabel(activeTab)}
        description={activeTab === 'dashboard'
          ? 'Employees, attendance, leave, payroll, performance and training at a glance.'
          : activeTab === 'myhr' ? 'Your profile, attendance, leave and payslips.' : undefined}
      />

      {group.subTabs && group.subTabs.length > 1 && (
        <Tabs
          label={`${group.label} sections`}
          value={activeTab}
          onValueChange={setTab}
          items={group.subTabs.map(st => ({ value: st.id, label: st.label }))}
        />
      )}

      {render(basePath)}
    </div>
  );
}
