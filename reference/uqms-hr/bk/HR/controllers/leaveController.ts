import { Request, Response } from 'express';
import LeaveType from '../models/LeaveType';
import LeaveBalance from '../models/LeaveBalance';
import LeaveRequest from '../models/LeaveRequest';
import Employee from '../models/Employee';
import { submitLeave, approveLeave, rejectOrCancelLeave } from '../services/leaveService';
import { AuthRequest } from '../../middleware/auth';

export const getLeaveTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const types = await LeaveType.find();
    res.status(200).json({ success: true, data: types, message: 'Leave types fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createLeaveType = async (req: Request, res: Response): Promise<void> => {
  try {
    const type = new LeaveType(req.body);
    await type.save();
    res.status(201).json({ success: true, data: type, message: 'Leave type created successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Leave type already exists' : error.message, details: [] });
  }
};

export const updateLeaveType = async (req: Request, res: Response): Promise<void> => {
  try {
    const type = await LeaveType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!type) {
      res.status(404).json({ success: false, error: 'Leave type not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: type, message: 'Leave type updated successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Leave type already exists' : error.message, details: [] });
  }
};

export const deleteLeaveType = async (req: Request, res: Response): Promise<void> => {
  try {
    const [requestCount, balanceCount] = await Promise.all([
      LeaveRequest.countDocuments({ leaveType: req.params.id }),
      LeaveBalance.countDocuments({ leaveType: req.params.id }),
    ]);
    if (requestCount > 0 || balanceCount > 0) {
      res.status(400).json({ success: false, error: 'Cannot delete: leave type is referenced by existing requests or balances', details: [] });
      return;
    }

    const type = await LeaveType.findByIdAndDelete(req.params.id);
    if (!type) {
      res.status(404).json({ success: false, error: 'Leave type not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: type, message: 'Leave type deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getAllBalances = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    filter.year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    if (req.query.employeeId) filter.employee = req.query.employeeId;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;

    const balances = await LeaveBalance.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .populate('leaveType', 'name isPaidLeave')
      .sort({ employee: 1 })
      .skip(skip)
      .limit(limit);

    const total = await LeaveBalance.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { balances, total, page, pages: Math.ceil(total / limit) },
      message: 'Leave balances fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getLeaveBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const year = new Date().getFullYear();
    const balances = await LeaveBalance.find({ employee: employeeId, year }).populate('leaveType');
    res.status(200).json({ success: true, data: balances, message: 'Balances fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const submitLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employee, leaveType, startDate, endDate, reason } = req.body;
    const request = await submitLeave(employee, leaveType, new Date(startDate), new Date(endDate), reason);
    res.status(201).json({ success: true, data: request, message: 'Leave request submitted successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const getLeaveRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.employeeId) filter.employee = req.query.employeeId;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const requests = await LeaveRequest.find(filter)
      .populate('leaveType')
      .populate('employee', 'firstName lastName employeeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await LeaveRequest.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { requests, total, page, pages: Math.ceil(total / limit) },
      message: 'Leave requests fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const approveRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id; // from auth middleware
    const request = await approveLeave(req.params.id as string, userId as string);
    res.status(200).json({ success: true, data: request, message: 'Leave approved successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const rejectRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const reason = (req.body.rejectionReason ?? req.body.comments) as string;
    const request = await rejectOrCancelLeave(req.params.id as string, 'Rejected', userId as string, reason);
    res.status(200).json({ success: true, data: request, message: 'Leave rejected successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const cancelRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const request = await rejectOrCancelLeave(req.params.id as string, 'Cancelled');
    res.status(200).json({ success: true, data: request, message: 'Leave cancelled successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const initializeBalances = async (req: Request, res: Response): Promise<void> => {
  try {
    const { year } = req.body;
    const employees = await Employee.find({ isDeleted: false, employmentStatus: 'Active' });
    const leaveTypes = await LeaveType.find();

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        await LeaveBalance.findOneAndUpdate(
          { employee: emp._id, leaveType: lt._id, year },
          {
            $setOnInsert: {
              employee: emp._id,
              leaveType: lt._id,
              year,
              totalDays: lt.defaultDaysPerYear,
              usedDays: 0,
              pendingDays: 0
            }
          },
          { upsert: true }
        );
      }
    }

    res.status(200).json({ success: true, message: 'Leave balances initialized successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
