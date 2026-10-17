import { Request, Response } from 'express';
import PublicHoliday from '../models/PublicHoliday';

export const getHolidays = async (req: Request, res: Response): Promise<void> => {
  try {
    const holidays = await PublicHoliday.find().sort({ date: 1 });
    res.status(200).json({ success: true, data: holidays, message: 'Holidays fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const addHoliday = async (req: Request, res: Response): Promise<void> => {
  try {
    const holiday = new PublicHoliday(req.body);
    await holiday.save();
    res.status(201).json({ success: true, data: holiday, message: 'Holiday added successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateHoliday = async (req: Request, res: Response): Promise<void> => {
  try {
    const holiday = await PublicHoliday.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!holiday) {
      res.status(404).json({ success: false, error: 'Holiday not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: holiday, message: 'Holiday updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const removeHoliday = async (req: Request, res: Response): Promise<void> => {
  try {
    const holiday = await PublicHoliday.findByIdAndDelete(req.params.id);
    if (!holiday) {
      res.status(404).json({ success: false, error: 'Holiday not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: holiday, message: 'Holiday removed successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
