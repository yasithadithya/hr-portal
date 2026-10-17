import SalaryStructure from '../models/SalaryStructure';
import AttendanceLog from '../models/AttendanceLog';
import PayrollRun from '../models/PayrollRun';
import LeaveRequest from '../models/LeaveRequest';

export const calculateIncomeTax = (annualGross: number): number => {
  let remaining = annualGross;
  let tax = 0;

  // Personal Relief for Sri Lanka APIT (approx 1.2M annually) 
  // Depending on exact requirements this might need adjustment, but we'll apply it.
  const relief = 1200000;
  remaining = Math.max(0, remaining - relief);

  if (remaining > 0) {
    const chunk = Math.min(remaining, 500000);
    tax += chunk * 0.06;
    remaining -= chunk;
  }
  if (remaining > 0) {
    const chunk = Math.min(remaining, 500000);
    tax += chunk * 0.12;
    remaining -= chunk;
  }
  if (remaining > 0) {
    const chunk = Math.min(remaining, 1000000);
    tax += chunk * 0.18;
    remaining -= chunk;
  }
  if (remaining > 0) {
    const chunk = Math.min(remaining, 1000000);
    tax += chunk * 0.24;
    remaining -= chunk;
  }
  if (remaining > 0) {
    const chunk = Math.min(remaining, 1000000);
    tax += chunk * 0.30;
    remaining -= chunk;
  }
  if (remaining > 0) {
    tax += remaining * 0.36;
  }
  
  return tax / 12; // monthly tax
};

export const computePayrollSummary = async (month?: number, year?: number) => {
  const filter: any = {};
  if (month) filter.month = month;
  if (year) filter.year = year;

  const runs = await PayrollRun.find(filter);

  const summary = {
    totalGrossSalary: 0,
    totalNetSalary: 0,
    totalEpfEmployer: 0,
    totalEtf: 0,
    totalDeductions: 0,
    totalEmployees: runs.length
  };

  runs.forEach(r => {
    summary.totalGrossSalary += r.grossSalary;
    summary.totalNetSalary += r.netSalary;
    summary.totalEpfEmployer += r.epfEmployer;
    summary.totalEtf += r.etf;
    summary.totalDeductions += r.totalDeductions;
  });

  return summary;
};

export const generatePayroll = async (employeeId: string, month: number, year: number) => {
  const salaryStructure = await SalaryStructure.findOne({ employee: employeeId, isActive: true });
  if (!salaryStructure) {
    throw new Error('Active salary structure not found for employee');
  }

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Last day of month
  endDate.setHours(23, 59, 59, 999);

  const logs = await AttendanceLog.find({
    employee: employeeId,
    date: { $gte: startDate, $lte: endDate }
  });

  let daysWorked = 0;
  let overtimeHours = 0;
  let absentDays = 0;

  logs.forEach(log => {
    if (log.status === 'Present' || log.status === 'HalfDay' || log.status === 'Late') {
      daysWorked++;
      overtimeHours += log.overtimeHours || 0;
    } else if (log.status === 'Absent') {
      absentDays++;
    }
  });

  const leaveRequests = await LeaveRequest.find({
    employee: employeeId,
    status: 'Approved',
    startDate: { $lte: endDate },
    endDate: { $gte: startDate }
  }).populate('leaveType');

  // Simplifying paid leave calculation for month
  let leaveDaysPaid = 0;
  leaveRequests.forEach((req: any) => {
    if (req.leaveType && req.leaveType.isPaidLeave) {
      const maxStart = req.startDate > startDate ? req.startDate : startDate;
      const minEnd = req.endDate < endDate ? req.endDate : endDate;
      if (maxStart <= minEnd) {
        let currentDate = new Date(maxStart);
        while (currentDate <= minEnd) {
          const day = currentDate.getDay();
          if (day !== 0 && day !== 6) {
            leaveDaysPaid++;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
    }
  });

  // Calculate working days in month
  let workingDaysInMonth = 0;
  let d = new Date(startDate);
  while (d <= endDate) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      workingDaysInMonth++;
    }
    d.setDate(d.getDate() + 1);
  }

  let basicSalary = salaryStructure.basicSalary;
  // Let's assume standard monthly salary is fixed if daysWorked + leaveDaysPaid >= workingDaysInMonth
  // Otherwise prorate.
  const totalPaidDays = daysWorked + leaveDaysPaid;
  if (totalPaidDays < workingDaysInMonth) {
    basicSalary = (basicSalary / workingDaysInMonth) * totalPaidDays;
  }

  const totalAllowances = salaryStructure.allowances.reduce((sum, a) => sum + a.amount, 0);
  
  const overtimeRate = (salaryStructure.basicSalary / 240) * 1.5;
  const overtimePay = overtimeHours * overtimeRate;

  const grossSalary = basicSalary + totalAllowances + overtimePay;

  const epfEmployee = grossSalary * 0.08;
  const epfEmployer = grossSalary * 0.12;
  const etf = grossSalary * 0.03;

  const annualTaxableGross = grossSalary * 12; // Simplified
  const monthlyIncomeTax = calculateIncomeTax(annualTaxableGross);

  const totalDeductions = epfEmployee + monthlyIncomeTax;

  const netSalary = grossSalary - totalDeductions;

  const payrollRun = new PayrollRun({
    employee: employeeId,
    month,
    year,
    basicSalary,
    totalAllowances,
    allowanceBreakdown: salaryStructure.allowances,
    overtimePay,
    grossSalary,
    epfEmployee,
    epfEmployer,
    etf,
    incomeTax: monthlyIncomeTax,
    otherDeductions: [],
    totalDeductions,
    netSalary,
    workingDaysInMonth,
    daysWorked,
    leaveDaysPaid,
    absentDays,
    overtimeHours,
    status: 'Draft'
  });

  await payrollRun.save();
  return payrollRun;
};
