import { Request, Response } from 'express';
import ChecklistTemplate from '../models/ChecklistTemplate';
import EmployeeChecklist from '../models/EmployeeChecklist';

// ----- Templates -----

export const getTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.activeOnly === 'true') filter.isActive = true;

    const templates = await ChecklistTemplate.find(filter).sort({ type: 1, name: 1 });
    res.status(200).json({ success: true, data: templates, message: 'Checklist templates fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const template = new ChecklistTemplate(req.body);
    await template.save();
    res.status(201).json({ success: true, data: template, message: 'Checklist template created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const template = await ChecklistTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!template) {
      res.status(404).json({ success: false, error: 'Checklist template not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: template, message: 'Checklist template updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const instanceCount = await EmployeeChecklist.countDocuments({ template: req.params.id });
    if (instanceCount > 0) {
      // Soft-delete: checklists reference this template, so just deactivate it
      const template = await ChecklistTemplate.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!template) {
        res.status(404).json({ success: false, error: 'Checklist template not found', details: [] });
        return;
      }
      res.status(200).json({ success: true, data: template, message: 'Template is in use — deactivated instead of deleted' });
      return;
    }

    const template = await ChecklistTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      res.status(404).json({ success: false, error: 'Checklist template not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: template, message: 'Checklist template deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

// ----- Employee checklist instances -----

export const createChecklistFromTemplate = async (templateId: string, employeeId: string, startDate: Date) => {
  const template = await ChecklistTemplate.findById(templateId);
  if (!template) {
    throw new Error('Checklist template not found');
  }

  const tasks = template.items.map(item => ({
    title: item.title,
    description: item.description,
    dueDate: new Date(startDate.getTime() + (item.dueOffsetDays || 0) * 24 * 60 * 60 * 1000),
    status: 'Pending' as const,
  }));

  return EmployeeChecklist.create({
    employee: employeeId,
    template: template._id,
    type: template.type,
    startDate,
    status: 'InProgress',
    tasks,
  });
};

export const createChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, templateId, startDate } = req.body;
    if (!employeeId || !templateId) {
      res.status(400).json({ success: false, error: 'employeeId and templateId are required', details: [] });
      return;
    }

    const checklist = await createChecklistFromTemplate(templateId, employeeId, startDate ? new Date(startDate) : new Date());
    res.status(201).json({ success: true, data: checklist, message: 'Checklist created successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const getChecklists = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};
    if (req.query.employeeId) filter.employee = req.query.employeeId;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const checklists = await EmployeeChecklist.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .populate('template', 'name')
      .populate('tasks.assignee', 'firstName lastName employeeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await EmployeeChecklist.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: { checklists, total, page, pages: Math.ceil(total / limit) },
      message: 'Checklists fetched successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const updateChecklistTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const checklist = await EmployeeChecklist.findById(req.params.id);
    if (!checklist) {
      res.status(404).json({ success: false, error: 'Checklist not found', details: [] });
      return;
    }

    const taskIndex = parseInt(req.params.taskIndex as string);
    const task = checklist.tasks[taskIndex];
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found', details: [] });
      return;
    }

    const { status, assignee, dueDate, notes } = req.body;
    if (status !== undefined) {
      task.status = status;
      task.completedAt = status === 'Done' ? new Date() : undefined;
    }
    if (assignee !== undefined) task.assignee = assignee || undefined;
    if (dueDate !== undefined) task.dueDate = dueDate ? new Date(dueDate) : undefined;
    if (notes !== undefined) task.notes = notes;

    const allClosed = checklist.tasks.every(t => t.status === 'Done' || t.status === 'Skipped');
    checklist.status = allClosed ? 'Completed' : 'InProgress';

    await checklist.save();
    res.status(200).json({ success: true, data: checklist, message: 'Task updated successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const checklist = await EmployeeChecklist.findByIdAndDelete(req.params.id);
    if (!checklist) {
      res.status(404).json({ success: false, error: 'Checklist not found', details: [] });
      return;
    }
    res.status(200).json({ success: true, data: checklist, message: 'Checklist deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
