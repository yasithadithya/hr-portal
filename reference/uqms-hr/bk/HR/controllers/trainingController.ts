import { Request, Response } from 'express';
import TrainingProgram from '../models/TrainingProgram';
import TrainingSession from '../models/TrainingSession';
import TrainingEnrollment from '../models/TrainingEnrollment';

// ----- Programs -----

export const getPrograms = async (req: Request, res: Response): Promise<void> => {
  try {
    const programs = await TrainingProgram.find().sort({ name: 1 });
    res.status(200).json({ success: true, data: programs, message: 'Training programs fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const program = new TrainingProgram(req.body);
    await program.save();
    res.status(201).json({ success: true, data: program, message: 'Training program created successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Training program already exists' : error.message, details: [] });
  }
};

export const updateProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const program = await TrainingProgram.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!program) {
      res.status(404).json({ success: false, error: 'Training program not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: program, message: 'Training program updated successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Training program already exists' : error.message, details: [] });
  }
};

export const deleteProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionCount = await TrainingSession.countDocuments({ program: req.params.id });
    if (sessionCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete: program has ${sessionCount} session(s)`, details: [] });
      return;
    }

    const program = await TrainingProgram.findByIdAndDelete(req.params.id);
    if (!program) {
      res.status(404).json({ success: false, error: 'Training program not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: program, message: 'Training program deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

// ----- Sessions -----

export const getSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.programId) filter.program = req.query.programId;
    if (req.query.status) filter.status = req.query.status;

    const sessions = await TrainingSession.find(filter)
      .populate('program', 'name category durationHours')
      .sort({ startDate: -1 });

    res.status(200).json({ success: true, data: sessions, message: 'Training sessions fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = new TrainingSession(req.body);
    await session.save();
    res.status(201).json({ success: true, data: session, message: 'Training session created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await TrainingSession.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!session) {
      res.status(404).json({ success: false, error: 'Training session not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: session, message: 'Training session updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

// ----- Enrollments -----

export const getSessionEnrollments = async (req: Request, res: Response): Promise<void> => {
  try {
    const enrollments = await TrainingEnrollment.find({ session: req.params.id })
      .populate('employee', 'firstName lastName employeeId')
      .sort({ createdAt: 1 });
    res.status(200).json({ success: true, data: enrollments, message: 'Enrollments fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const enrollEmployee = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await TrainingSession.findById(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Training session not found', details: [] });
      return;
    }
    if (session.status !== 'Scheduled') {
      res.status(400).json({ success: false, error: 'Can only enroll in Scheduled sessions', details: [] });
      return;
    }

    if (session.capacity) {
      const enrolledCount = await TrainingEnrollment.countDocuments({ session: session._id, status: { $ne: 'Cancelled' } });
      if (enrolledCount >= session.capacity) {
        res.status(400).json({ success: false, error: 'Session is at full capacity', details: [] });
        return;
      }
    }

    const enrollment = new TrainingEnrollment({ session: session._id, employee: req.body.employeeId });
    await enrollment.save();
    res.status(201).json({ success: true, data: enrollment, message: 'Employee enrolled successfully' });
  } catch (error: any) {
    const code = error.code === 11000 ? 409 : 400;
    res.status(code).json({ success: false, error: error.code === 11000 ? 'Employee is already enrolled in this session' : error.message, details: [] });
  }
};

export const updateEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const update: any = { ...req.body };
    if (update.status === 'Completed' && !update.completedAt) {
      update.completedAt = new Date();
    }

    const enrollment = await TrainingEnrollment.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: enrollment, message: 'Enrollment updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const enrollment = await TrainingEnrollment.findByIdAndDelete(req.params.id);
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: enrollment, message: 'Enrollment removed successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getEmployeeTrainings = async (req: Request, res: Response): Promise<void> => {
  try {
    const enrollments = await TrainingEnrollment.find({ employee: req.params.employeeId })
      .populate({
        path: 'session',
        populate: { path: 'program', select: 'name category durationHours' },
      })
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: enrollments, message: 'Employee trainings fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
