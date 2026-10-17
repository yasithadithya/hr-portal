import { Request, Response } from 'express';
import mongoose from 'mongoose';
import AttendanceLog from '../models/AttendanceLog';
import { AuthRequest } from '../../middleware/auth';
import Employee from '../models/Employee';

// Accepts either a Mongo _id (what the UI sends) or a business employeeId like "EMP001"
export const findEmployeeByAnyId = async (id: string) => {
  if (mongoose.isValidObjectId(id)) {
    const byId = await Employee.findOne({ _id: id, isDeleted: false });
    if (byId) return byId;
  }
  return Employee.findOne({ employeeId: id, isDeleted: false });
};

export const performClockIn = async (employeeMongoId: mongoose.Types.ObjectId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let log = await AttendanceLog.findOne({
    employee: employeeMongoId,
    date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
  });

  if (log && log.clockIn) {
    throw new Error('Already clocked in today');
  }

  if (!log) {
    log = new AttendanceLog({
      employee: employeeMongoId,
      date: today,
      clockIn: new Date(),
      status: 'Present',
      isManualEntry: false
    });
  } else {
    log.clockIn = new Date();
    log.status = 'Present';
  }

  await log.save();
  return log;
};

export const performClockOut = async (employeeMongoId: mongoose.Types.ObjectId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const log = await AttendanceLog.findOne({
    employee: employeeMongoId,
    date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
  });

  if (!log || !log.clockIn) {
    throw new Error('Not clocked in today');
  }
  if (log.clockOut) {
    throw new Error('Already clocked out today');
  }

  const clockOutTime = new Date();
  const workedMs = clockOutTime.getTime() - log.clockIn.getTime();
  const workedHours = workedMs / (1000 * 60 * 60);

  log.clockOut = clockOutTime;
  log.workedHours = parseFloat(workedHours.toFixed(2));
  log.overtimeHours = log.workedHours > 8 ? parseFloat((log.workedHours - 8).toFixed(2)) : 0;

  await log.save();
  return log;
};

export const clockIn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeId } = req.body;
    const employee = await findEmployeeByAnyId(employeeId);
    if (!employee) {
      res.status(404).json({ success: false, error: 'Employee not found', details: [] });
      return;
    }

    const log = await performClockIn(employee._id as mongoose.Types.ObjectId);
    res.status(200).json({ success: true, data: log, message: 'Clocked in successfully' });
  } catch (error: any) {
    const code = /Already clocked in/.test(error.message) ? 400 : 500;
    res.status(code).json({ success: false, error: error.message, details: [] });
  }
};

export const clockOut = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeId } = req.body;
    const employee = await findEmployeeByAnyId(employeeId);
    if (!employee) {
      res.status(404).json({ success: false, error: 'Employee not found', details: [] });
      return;
    }

    const log = await performClockOut(employee._id as mongoose.Types.ObjectId);
    res.status(200).json({ success: true, data: log, message: 'Clocked out successfully' });
  } catch (error: any) {
    const code = /clocked (in|out) today/.test(error.message) ? 400 : 500;
    res.status(code).json({ success: false, error: error.message, details: [] });
  }
};

export const getAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { month, year } = req.query;
    const employeeId = req.params.employeeId;

    const filter: any = { employee: employeeId };

    if (month && year) {
      const startDate = new Date(parseInt(year as string), parseInt(month as string) - 1, 1);
      const endDate = new Date(parseInt(year as string), parseInt(month as string), 0);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const logs = await AttendanceLog.find(filter).sort({ date: -1 });
    res.status(200).json({ success: true, data: logs, message: 'Attendance fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const employeeId = req.params.employeeId;
    const { month, year } = req.query;

    const filter: any = { employee: employeeId };
    if (month && year) {
      const startDate = new Date(parseInt(year as string), parseInt(month as string) - 1, 1);
      const endDate = new Date(parseInt(year as string), parseInt(month as string), 0);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const logs = await AttendanceLog.find(filter);

    const summary = {
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0,
      onLeave: 0,
      holiday: 0,
      totalOvertimeHours: 0,
    };

    logs.forEach(log => {
      if (summary.hasOwnProperty(log.status.toLowerCase())) {
        (summary as any)[log.status.toLowerCase()]++;
      } else if (log.status === 'OnLeave') {
        summary.onLeave++;
      } else if (log.status === 'HalfDay') {
        summary.halfDay++;
      }
      summary.totalOvertimeHours += (log.overtimeHours || 0);
    });

    res.status(200).json({ success: true, data: summary, message: 'Summary fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const manualEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeId, date, clockIn, clockOut, status, notes } = req.body;
    
    let workedHours = 0;
    let overtimeHours = 0;

    if (clockIn && clockOut) {
      const inTime = new Date(clockIn);
      const outTime = new Date(clockOut);
      workedHours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);
      overtimeHours = workedHours > 8 ? workedHours - 8 : 0;
    }

    const logDate = new Date(date);
    logDate.setHours(0, 0, 0, 0);

    const log = await AttendanceLog.findOneAndUpdate(
      { employee: employeeId, date: logDate },
      {
        employee: employeeId,
        date: logDate,
        clockIn,
        clockOut,
        workedHours,
        overtimeHours,
        status,
        isManualEntry: true,
        enteredBy: req.user?.id,
        notes
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: log, message: 'Manual entry saved successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};
