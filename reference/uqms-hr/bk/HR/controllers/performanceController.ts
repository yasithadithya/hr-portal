import { Request, Response } from 'express';
import ReviewCycle from '../models/ReviewCycle';
import Goal from '../models/Goal';
import Appraisal from '../models/Appraisal';

// ----- Review cycles -----

export const getReviewCycles = async (req: Request, res: Response): Promise<void> => {
  try {
    const cycles = await ReviewCycle.find().sort({ periodStart: -1 });
    res.status(200).json({ success: true, data: cycles, message: 'Review cycles fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createReviewCycle = async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = new ReviewCycle(req.body);
    await cycle.save();
    res.status(201).json({ success: true, data: cycle, message: 'Review cycle created successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Review cycle name already exists' : error.message, details: [] });
  }
};

export const updateReviewCycle = async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = await ReviewCycle.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!cycle) {
      res.status(404).json({ success: false, error: 'Review cycle not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: cycle, message: 'Review cycle updated successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Review cycle name already exists' : error.message, details: [] });
  }
};

// ----- Goals -----

export const getGoals = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.employeeId) filter.employee = req.query.employeeId;
    if (req.query.cycleId) filter.cycle = req.query.cycleId;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;

    const goals = await Goal.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .populate('cycle', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Goal.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { goals, total, page, pages: Math.ceil(total / limit) },
      message: 'Goals fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const goal = new Goal(req.body);
    await goal.save();
    res.status(201).json({ success: true, data: goal, message: 'Goal created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const goal = await Goal.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!goal) {
      res.status(404).json({ success: false, error: 'Goal not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: goal, message: 'Goal updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const goal = await Goal.findByIdAndDelete(req.params.id);
    if (!goal) {
      res.status(404).json({ success: false, error: 'Goal not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: goal, message: 'Goal deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

// ----- Appraisals -----

export const getAppraisals = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.cycleId) filter.cycle = req.query.cycleId;
    if (req.query.employeeId) filter.employee = req.query.employeeId;
    if (req.query.status) filter.status = req.query.status;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;

    const appraisals = await Appraisal.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .populate('reviewer', 'firstName lastName employeeId')
      .populate('cycle', 'name status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Appraisal.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { appraisals, total, page, pages: Math.ceil(total / limit) },
      message: 'Appraisals fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createAppraisal = async (req: Request, res: Response): Promise<void> => {
  try {
    const appraisal = new Appraisal({ ...req.body, status: 'Draft' });
    await appraisal.save();
    res.status(201).json({ success: true, data: appraisal, message: 'Appraisal created successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'An appraisal already exists for this employee in this cycle' : error.message, details: [] });
  }
};

export const updateAppraisal = async (req: Request, res: Response): Promise<void> => {
  try {
    const appraisal = await Appraisal.findById(req.params.id);
    if (!appraisal) {
      res.status(404).json({ success: false, error: 'Appraisal not found', details: [] });
      return;
    }
    if (appraisal.status !== 'Draft') {
      res.status(400).json({ success: false, error: 'Only Draft appraisals can be edited', details: [] });
      return;
    }

    const { status, submittedAt, acknowledgedAt, ...updatable } = req.body;
    Object.assign(appraisal, updatable);
    await appraisal.save();

    res.status(200).json({ success: true, data: appraisal, message: 'Appraisal updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const submitAppraisal = async (req: Request, res: Response): Promise<void> => {
  try {
    const appraisal = await Appraisal.findById(req.params.id);
    if (!appraisal) {
      res.status(404).json({ success: false, error: 'Appraisal not found', details: [] });
      return;
    }
    if (appraisal.status !== 'Draft') {
      res.status(400).json({ success: false, error: 'Only Draft appraisals can be submitted', details: [] });
      return;
    }
    if (!appraisal.ratings || appraisal.ratings.length === 0) {
      res.status(400).json({ success: false, error: 'Cannot submit an appraisal without ratings', details: [] });
      return;
    }

    if (!appraisal.overallRating) {
      const sum = appraisal.ratings.reduce((acc, r) => acc + r.rating, 0);
      appraisal.overallRating = Math.round((sum / appraisal.ratings.length) * 10) / 10;
    }

    appraisal.status = 'Submitted';
    appraisal.submittedAt = new Date();
    await appraisal.save();

    res.status(200).json({ success: true, data: appraisal, message: 'Appraisal submitted successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const acknowledgeAppraisal = async (req: Request, res: Response): Promise<void> => {
  try {
    const appraisal = await Appraisal.findById(req.params.id);
    if (!appraisal) {
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
