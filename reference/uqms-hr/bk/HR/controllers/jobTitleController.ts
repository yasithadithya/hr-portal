import { Request, Response } from 'express';
import JobTitle from '../models/JobTitle';
import Employee from '../models/Employee';

export const getJobTitles = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobTitles = await JobTitle.find();
    res.status(200).json({ success: true, data: jobTitles, message: 'Job Titles fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createJobTitle = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobTitle = new JobTitle(req.body);
    await jobTitle.save();
    res.status(201).json({ success: true, data: jobTitle, message: 'Job Title created successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Job title already exists' : error.message, details: [] });
  }
};

export const updateJobTitle = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobTitle = await JobTitle.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!jobTitle) {
      res.status(404).json({ success: false, error: 'Job title not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: jobTitle, message: 'Job Title updated successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Job title already exists' : error.message, details: [] });
  }
};

export const deleteJobTitle = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeEmployees = await Employee.countDocuments({ jobTitle: req.params.id, isDeleted: false });
    if (activeEmployees > 0) {
      res.status(400).json({ success: false, error: `Cannot delete: job title is assigned to ${activeEmployees} active employee(s)`, details: [] });
      return;
    }

    const jobTitle = await JobTitle.findByIdAndDelete(req.params.id);
    if (!jobTitle) {
      res.status(404).json({ success: false, error: 'Job title not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: jobTitle, message: 'Job Title deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
