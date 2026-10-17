import { Request, Response } from 'express';
import SalaryStructure from '../models/SalaryStructure';
import PayrollRun from '../models/PayrollRun';
import { generatePayroll, computePayrollSummary } from '../services/payrollService';
import Employee from '../models/Employee';
import { AuthRequest } from '../../middleware/auth';
import mongoose from 'mongoose';

export const setSalaryStructure = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, basicSalary, allowances, effectiveFrom } = req.body;

    await SalaryStructure.updateMany({ employee: employeeId }, { isActive: false });

    const newStructure = new SalaryStructure({
      employee: employeeId,
      basicSalary,
      allowances,
      effectiveFrom,
      isActive: true
    });

    await newStructure.save();
    res.status(201).json({ success: true, data: newStructure, message: 'Salary structure updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const getSalaryStructure = async (req: Request, res: Response): Promise<void> => {
  try {
    const structure = await SalaryStructure.findOne({ employee: req.params.employeeId, isActive: true });
    if (!structure) {
      res.status(404).json({ success: false, error: 'Active salary structure not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: structure, message: 'Salary structure fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const generateSinglePayroll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, month, year } = req.body;
    
    // Check if already generated
    const existing = await PayrollRun.findOne({ employee: employeeId, month, year });
    if (existing) {
      res.status(400).json({ success: false, error: 'Payroll already generated for this month', details: [] });
      return;
    }

    const payroll = await generatePayroll(employeeId, month, year);
    res.status(201).json({ success: true, data: payroll, message: 'Payroll generated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const generateBulkPayroll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { month, year } = req.body;
    const employees = await Employee.find({ employmentStatus: 'Active', isDeleted: false });
    
    const results: any[] = [];
    for (const emp of employees) {
      try {
        const existing = await PayrollRun.findOne({ employee: emp._id, month, year });
        if (!existing) {
          const pr = await generatePayroll(emp._id.toString(), month, year);
          results.push({ employeeId: emp.employeeId, status: 'Success', payrollId: pr._id });
        } else {
          results.push({ employeeId: emp.employeeId, status: 'Skipped (Already exists)' });
        }
      } catch (err: any) {
        results.push({ employeeId: emp.employeeId, status: 'Failed', error: err.message });
      }
    }

    res.status(200).json({ success: true, data: results, message: 'Bulk generation completed' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const listPayrollRuns = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = req.query.year;
    if (req.query.employeeId) filter.employee = req.query.employeeId;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const runs = await PayrollRun.find(filter)
      .populate('employee', 'firstName lastName employeeId department jobTitle')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await PayrollRun.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { runs, total, page, pages: Math.ceil(total / limit) },
      message: 'Payroll runs fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getPayrollRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await PayrollRun.findById(req.params.id).populate('employee');
    if (!run) {
      res.status(404).json({ success: false, error: 'Payroll run not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: run, message: 'Payroll run fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const approvePayrollRun = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const run = await PayrollRun.findByIdAndUpdate(
      req.params.id,
      { status: 'Approved', approvedBy: new mongoose.Types.ObjectId(req.user?.id) },
      { new: true }
    );
    if (!run) {
      res.status(404).json({ success: false, error: 'Payroll run not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: run, message: 'Payroll approved successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const markPayrollPaid = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await PayrollRun.findByIdAndUpdate(
      req.params.id,
      { status: 'Paid', paidAt: new Date() },
      { new: true }
    );
    if (!run) {
      res.status(404).json({ success: false, error: 'Payroll run not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: run, message: 'Payroll marked as paid' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const generatePayslip = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await PayrollRun.findById(req.params.id).populate('employee');
    if (!run) {
      res.status(404).json({ success: false, error: 'Payroll run not found', details: [] });
      return;
    }
    // Return JSON data suitable for frontend to render PDF
    res.status(200).json({ success: true, data: run, message: 'Payslip data fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getPayrollSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { month, year } = req.query;
    const summary = await computePayrollSummary(
      month ? parseInt(month as string) : undefined,
      year ? parseInt(year as string) : undefined
    );

    res.status(200).json({ success: true, data: summary, message: 'Payroll summary fetched' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
