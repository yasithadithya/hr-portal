import { Response } from 'express';
import Announcement from '../models/Announcement';
import { AuthRequest } from '../../middleware/auth';

export const getAnnouncements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.activeOnly === 'true') {
      const now = new Date();
      filter.isActive = true;
      filter.publishDate = { $lte: now };
      filter.$or = [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gte: now } }];
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const announcements = await Announcement.find(filter)
      .sort({ priority: -1, publishDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Announcement.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { announcements, total, page, pages: Math.ceil(total / limit) },
      message: 'Announcements fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const announcement = new Announcement({ ...req.body, createdBy: req.user?.id });
    await announcement.save();
    res.status(201).json({ success: true, data: announcement, message: 'Announcement created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const announcement = await Announcement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!announcement) {
      res.status(404).json({ success: false, error: 'Announcement not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: announcement, message: 'Announcement updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteAnnouncement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
      res.status(404).json({ success: false, error: 'Announcement not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: announcement, message: 'Announcement deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
