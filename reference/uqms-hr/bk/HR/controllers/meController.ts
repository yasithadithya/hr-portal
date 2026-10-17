import { Response } from 'express';
import mongoose from 'mongoose';
import Employee from '../models/Employee';
import PayrollRun from '../models/PayrollRun';
import LeaveBalance from '../models/LeaveBalance';
import LeaveRequest from '../models/LeaveRequest';
import AttendanceLog from '../models/AttendanceLog';
import Appraisal from '../models/Appraisal';
import TrainingEnrollment from '../models/TrainingEnrollment';
import Announcement from '../models/Announcement';
import { AuthRequest } from '../../middleware/auth';
import { submitLeave, rejectOrCancelLeave } from '../services/leaveService';
import { performClockIn, performClockOut } from './attendanceController';

const resolveMyEmployee = async (req: AuthRequest) => {
  if (!req.user?.id) return null;
  return Employee.findOne({ userId: req.user.id, isDeleted: false });
};

const notLinked = (res: Response) => {
  res.status(404).json({ success: false, error: 'No employee profile is linked to your account', details: [] });
};

export const getMyProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const profile = await Employee.findById(me._id)
      .populate('department')
      .populate('jobTitle')
      .populate('reportsTo', 'firstName lastName employeeId');

    res.status(200).json({ success: true, data: profile, message: 'Profile fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyPayslips = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const skip = (page - 1) * limit;

    // Never expose Draft runs to employees
    const filter = { employee: me._id, status: { $in: ['Approved', 'Paid'] } };

    const runs = await PayrollRun.find(filter)
      .sort({ year: -1, month: -1 })
      .skip(skip)
      .limit(limit);

    const total = await PayrollRun.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { runs, total, page, pages: Math.ceil(total / limit) },
      message: 'Payslips fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyPayslip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      employee: me._id,
      status: { $in: ['Approved', 'Paid'] },
    }).populate('employee', 'firstName lastName employeeId');

    if (!run) {
      res.status(404).json({ success: false, error: 'Payslip not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: run, message: 'Payslip fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyLeaveBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const balances = await LeaveBalance.find({ employee: me._id, year }).populate('leaveType');
    res.status(200).json({ success: true, data: balances, message: 'Balances fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyLeaveRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const requests = await LeaveRequest.find({ employee: me._id })
      .populate('leaveType')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await LeaveRequest.countDocuments({ employee: me._id });

    res.status(200).json({
      success: true,
      data: { requests, total, page, pages: Math.ceil(total / limit) },
      message: 'Leave requests fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const submitMyLeaveRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const { leaveType, startDate, endDate, reason } = req.body;
    const request = await submitLeave(String(me._id), leaveType, new Date(startDate), new Date(endDate), reason);
    res.status(201).json({ success: true, data: request, message: 'Leave request submitted successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const cancelMyLeaveRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const request = await LeaveRequest.findById(req.params.id);
    if (!request || String(request.employee) !== String(me._id)) {
      res.status(404).json({ success: false, error: 'Leave request not found', details: [] });
      return;
    }
    if (request.status !== 'Pending') {
      res.status(400).json({ success: false, error: 'Only pending requests can be cancelled', details: [] });
      return;
    }

    const cancelled = await rejectOrCancelLeave(String(request._id), 'Cancelled');
    res.status(200).json({ success: true, data: cancelled, message: 'Leave request cancelled successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const myClockIn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const log = await performClockIn(me._id as mongoose.Types.ObjectId);
    res.status(200).json({ success: true, data: log, message: 'Clocked in successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const myClockOut = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const log = await performClockOut(me._id as mongoose.Types.ObjectId);
    res.status(200).json({ success: true, data: log, message: 'Clocked out successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const { month, year } = req.query;
    const filter: any = { employee: me._id };

    if (month && year) {
      const startDate = new Date(parseInt(year as string), parseInt(month as string) - 1, 1);
      const endDate = new Date(parseInt(year as string), parseInt(month as string), 0);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const logs = await AttendanceLog.find(filter).sort({ date: -1 }).limit(100);
    res.status(200).json({ success: true, data: logs, message: 'Attendance fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyAppraisals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    // Employees only see appraisals once submitted — never drafts
    const appraisals = await Appraisal.find({ employee: me._id, status: { $in: ['Submitted', 'Acknowledged'] } })
      .populate('reviewer', 'firstName lastName employeeId')
      .populate('cycle', 'name periodStart periodEnd')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: appraisals, message: 'Appraisals fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const acknowledgeMyAppraisal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const appraisal = await Appraisal.findById(req.params.id);
    if (!appraisal || String(appraisal.employee) !== String(me._id)) {
      res.status(404).json({ success: false, error: 'Appraisal not found', details: [] });
      return;
    }
    if (appraisal.status !== 'Submitted') {
      res.status(400).json({ success: false, error: 'Only Submitted appraisals can be acknowledged', details: [] });
      return;
    }

    if (req.body.employeeComments) appraisal.employeeComments = req.body.employeeComments;
    appraisal.status = 'Acknowledged';
    appraisal.acknowledgedAt = new Date();
    await appraisal.save();

    res.status(200).json({ success: true, data: appraisal, message: 'Appraisal acknowledged successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyAnnouncements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      isActive: true,
      publishDate: { $lte: now },
      $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gte: now } }],
    })
      .sort({ priority: -1, publishDate: -1 })
      .limit(10);

    res.status(200).json({ success: true, data: announcements, message: 'Announcements fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getMyTrainings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await resolveMyEmployee(req);
    if (!me) return notLinked(res);

    const enrollments = await TrainingEnrollment.find({ employee: me._id })
      .populate({
        path: 'session',
        populate: { path: 'program', select: 'name category durationHours' },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: enrollments, message: 'Trainings fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
