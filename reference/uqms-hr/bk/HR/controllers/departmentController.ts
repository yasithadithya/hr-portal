import { Request, Response } from 'express';
import Department from '../models/Department';
import Employee from '../models/Employee';

export const getDepartments = async (req: Request, res: Response): Promise<void> => {
  try {
    const departments = await Department.find().populate('headOfDepartment');
    res.status(200).json({ success: true, data: departments, message: 'Departments fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = new Department(req.body);
    await department.save();
    res.status(201).json({ success: true, data: department, message: 'Department created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!department) {
      res.status(404).json({ success: false, error: 'Department not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: department, message: 'Department updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeEmployees = await Employee.countDocuments({ department: req.params.id, isDeleted: false });
    if (activeEmployees > 0) {
      res.status(400).json({ success: false, error: `Cannot delete: department has ${activeEmployees} active employee(s)`, details: [] });
      return;
    }

    const department = await Department.findByIdAndDelete(req.params.id);
    if (!department) {
      res.status(404).json({ success: false, error: 'Department not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: department, message: 'Department deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
