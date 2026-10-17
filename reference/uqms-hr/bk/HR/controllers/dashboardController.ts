import { Request, Response } from 'express';
import Employee from '../models/Employee';
import Department from '../models/Department';
import AttendanceLog from '../models/AttendanceLog';
import LeaveRequest from '../models/LeaveRequest';
import Announcement from '../models/Announcement';
import EmployeeDocument from '../models/EmployeeDocument';
import { computePayrollSummary } from '../services/payrollService';
import { AuthRequest } from '../../middleware/auth';
import { userCan } from '../../utils/permissions';

// Upcoming birthdays/anniversaries within the next `days`, computed in JS to
// handle year boundaries safely.
const upcomingWithin = (employees: any[], dateField: 'dateOfBirth' | 'joinedDate', days: number) => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const results: any[] = [];

  employees.forEach(emp => {
    const source = emp[dateField];
    if (!source) return;
    const d = new Date(source);
    let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    if (next < now) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
    const diffDays = Math.round((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= days) {
      results.push({
        _id: emp._id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        date: next,
        inDays: diffDays,
        years: now.getFullYear() - d.getFullYear() + (next.getFullYear() > now.getFullYear() ? 1 : 0),
      });
    }
  });

  return results.sort((a, b) => a.inDays - b.inDays);
};

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // Each section is only included for users who can read the HR area it comes from.
    const authReq = req as AuthRequest;
    const [canAttendance, canLeave, canPayroll, canEmployees] = await Promise.all([
      userCan(authReq, 'hr.attendance', 'read'),
      userCan(authReq, 'hr.leave', 'read'),
      userCan(authReq, 'hr.payroll', 'read'),
      userCan(authReq, 'hr.employees', 'read'),
    ]);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [
      headcountRaw,
      departmentRaw,
      departments,
      attendanceTodayRaw,
      pendingLeavesCount,
      latestPendingLeaves,
      activeEmployees,
      payrollSummary,
      expiringDocuments,
      announcementsRes,
    ] = await Promise.all([
      Employee.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$employmentStatus', count: { $sum: 1 } } },
      ]),
      Employee.aggregate([
        { $match: { isDeleted: false, employmentStatus: { $in: ['Active', 'OnProbation'] } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ]),
      Department.find().select('name'),
      canAttendance
        ? AttendanceLog.aggregate([
            { $match: { date: { $gte: todayStart, $lt: todayEnd } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
        : [],
      canLeave ? LeaveRequest.countDocuments({ status: 'Pending' }) : 0,
      !canLeave ? [] : LeaveRequest.find({ status: 'Pending' })
        .populate('employee', 'firstName lastName employeeId')
        .populate('leaveType', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      Employee.find({ isDeleted: false, employmentStatus: { $in: ['Active', 'OnProbation'] } })
        .select('employeeId firstName lastName dateOfBirth joinedDate'),
      canPayroll ? computePayrollSummary(now.getMonth() + 1, now.getFullYear()) : null,
      !canEmployees ? [] : EmployeeDocument.find({
        expiryDate: { $gte: now, $lte: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) },
      })
        .populate('employee', 'firstName lastName employeeId')
        .sort({ expiryDate: 1 })
        .limit(10),
      Announcement.find({
        isActive: true,
        publishDate: { $lte: now },
        $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gte: now } }],
      })
        .sort({ priority: -1, publishDate: -1 })
        .limit(5),
    ]);

    const headcount: Record<string, number> = {};
    let totalHeadcount = 0;
    headcountRaw.forEach((h: any) => {
      headcount[h._id || 'Unknown'] = h.count;
      totalHeadcount += h.count;
    });

    const deptNameMap = new Map(departments.map((d: any) => [String(d._id), d.name]));
    const departmentDistribution = departmentRaw
      .map((d: any) => ({
        department: d._id ? (deptNameMap.get(String(d._id)) || 'Unknown') : 'Unassigned',
        count: d.count,
      }))
      .sort((a: any, b: any) => b.count - a.count);

    const attendanceToday: Record<string, number> = {};
    attendanceTodayRaw.forEach((a: any) => {
      attendanceToday[a._id] = a.count;
    });

    res.status(200).json({
      success: true,
      data: {
        headcount: { total: totalHeadcount, byStatus: headcount },
        departmentDistribution,
        attendanceToday,
        pendingLeaves: { count: pendingLeavesCount, latest: latestPendingLeaves },
        upcomingBirthdays: upcomingWithin(activeEmployees, 'dateOfBirth', 30),
        upcomingAnniversaries: upcomingWithin(activeEmployees, 'joinedDate', 30),
        payrollSummary,
        expiringDocuments,
        announcements: announcementsRes,
      },
      message: 'Dashboard stats fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
