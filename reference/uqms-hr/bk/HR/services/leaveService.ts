import PublicHoliday from '../models/PublicHoliday';
import LeaveBalance from '../models/LeaveBalance';
import AttendanceLog from '../models/AttendanceLog';
import LeaveRequest from '../models/LeaveRequest';
import mongoose from 'mongoose';

export const calculateLeaveDays = async (startDate: Date, endDate: Date): Promise<number> => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const holidays = await PublicHoliday.find({
    date: { $gte: start, $lte: end },
  });

  const holidayDates = new Set(holidays.map((h) => h.date.toDateString()));

  let totalDays = 0;
  let currentDate = new Date(start);

  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    // Exclude Sat (6) and Sun (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      if (!holidayDates.has(currentDate.toDateString())) {
        totalDays++;
      }
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return totalDays;
};

export const submitLeave = async (
  employee: string,
  leaveType: string,
  startDate: Date,
  endDate: Date,
  reason?: string
) => {
  const totalDays = await calculateLeaveDays(startDate, endDate);
  if (totalDays <= 0) {
    throw new Error('Invalid date range or no working days selected');
  }

  const year = startDate.getFullYear();
  const balance = await LeaveBalance.findOne({ employee, leaveType, year });

  if (!balance || balance.remainingDays < totalDays) {
    throw new Error('Insufficient leave balance');
  }

  const request = new LeaveRequest({
    employee, leaveType, startDate, endDate, totalDays, reason, status: 'Pending'
  });

  await request.save();

  balance.pendingDays += totalDays;
  await balance.save();

  return request;
};

export const approveLeave = async (leaveRequestId: string, approvedBy: string) => {
  const request = await LeaveRequest.findById(leaveRequestId);
  if (!request || request.status !== 'Pending') {
    throw new Error('Leave request not found or not in pending state');
  }

  const balance = await LeaveBalance.findOne({
    employee: request.employee,
    leaveType: request.leaveType,
    year: request.startDate.getFullYear()
  });

  if (!balance) {
    throw new Error('Leave balance not found');
  }

  if (balance.pendingDays < request.totalDays) {
    throw new Error('Inconsistent pending days');
  }

  balance.pendingDays -= request.totalDays;
  balance.usedDays += request.totalDays;
  await balance.save();

  request.status = 'Approved';
  request.approvedBy = new mongoose.Types.ObjectId(approvedBy);
  request.approvedAt = new Date();
  await request.save();

  // Create attendance logs for those dates
  let currentDate = new Date(request.startDate);
  const end = new Date(request.endDate);
  
  const holidays = await PublicHoliday.find({
    date: { $gte: currentDate, $lte: end },
  });
  const holidayDates = new Set(holidays.map((h) => h.date.toDateString()));

  const logs: any[] = [];
  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(currentDate.toDateString())) {
      logs.push({
        employee: request.employee,
        date: new Date(currentDate),
        status: 'OnLeave',
        isManualEntry: true,
        notes: `Approved leave: ${request.reason || 'No reason provided'}`
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (logs.length > 0) {
    // Upsert attendance logs
    for (const log of logs) {
      await AttendanceLog.findOneAndUpdate(
        { employee: log.employee, date: log.date },
        { $set: log },
        { upsert: true, new: true }
      );
    }
  }

  return request;
};

export const rejectOrCancelLeave = async (leaveRequestId: string, newStatus: 'Rejected' | 'Cancelled', userId?: string, reason?: string) => {
  const request = await LeaveRequest.findById(leaveRequestId);
  if (!request) {
    throw new Error('Leave request not found');
  }

  if (request.status === 'Approved') {
    const balance = await LeaveBalance.findOne({
      employee: request.employee,
      leaveType: request.leaveType,
      year: request.startDate.getFullYear()
    });
    if (balance) {
      balance.usedDays -= request.totalDays;
      await balance.save();
    }
    
    // Remove OnLeave attendance logs
    let currentDate = new Date(request.startDate);
    const end = new Date(request.endDate);
    while (currentDate <= end) {
      await AttendanceLog.findOneAndDelete({ employee: request.employee, date: new Date(currentDate), status: 'OnLeave' });
      currentDate.setDate(currentDate.getDate() + 1);
    }
  } else if (request.status === 'Pending') {
    const balance = await LeaveBalance.findOne({
      employee: request.employee,
      leaveType: request.leaveType,
      year: request.startDate.getFullYear()
    });
    if (balance) {
      balance.pendingDays -= request.totalDays;
      await balance.save();
    }
  }

  request.status = newStatus;
  if (newStatus === 'Rejected') {
    request.rejectionReason = reason;
    if (userId) request.approvedBy = new mongoose.Types.ObjectId(userId);
  }
  await request.save();
  return request;
};
