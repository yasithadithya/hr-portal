import { Request, Response } from 'express';
import EmployeeDocument from '../models/EmployeeDocument';
import Employee from '../models/Employee';
import { uploadToR2, deleteFromR2 } from '../../services/r2Storage';
import { buildHrObjectKey, documentMimeTypes } from '../services/hrFileService';
import { AuthRequest } from '../../middleware/auth';

export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded', details: [] });
      return;
    }

    if (!documentMimeTypes.has(file.mimetype)) {
      res.status(400).json({ success: false, error: 'Invalid file type. Only PDF, Word, Excel, and image files are allowed.', details: [] });
      return;
    }

    const employee = await Employee.findOne({ _id: req.params.employeeId, isDeleted: false });
    if (!employee) {
      res.status(404).json({ success: false, error: 'Employee not found', details: [] });
      return;
    }

    const { title, category, expiryDate, notes } = req.body;
    if (!title) {
      res.status(400).json({ success: false, error: 'Document title is required', details: [] });
      return;
    }

    const key = buildHrObjectKey(file.originalname, file.mimetype, `hr/documents/${employee._id}`);
    const uploadResult = await uploadToR2({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      contentLength: file.size,
    });

    const document = await EmployeeDocument.create({
      employee: employee._id,
      title,
      category: category || 'Other',
      fileKey: uploadResult.key,
      fileUrl: uploadResult.url,
      contentType: file.mimetype,
      size: file.size,
      expiryDate: expiryDate || undefined,
      uploadedBy: req.user?.id,
      notes,
    });

    res.status(201).json({ success: true, data: document, message: 'Document uploaded successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getExpiringDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 60;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const documents = await EmployeeDocument.find({ expiryDate: { $gte: now, $lte: cutoff } })
      .populate('employee', 'firstName lastName employeeId')
      .sort({ expiryDate: 1 });

    res.status(200).json({ success: true, data: documents, message: 'Expiring documents fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const getEmployeeDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const documents = await EmployeeDocument.find({ employee: req.params.employeeId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: documents, message: 'Documents fetched successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};

export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const document = await EmployeeDocument.findById(req.params.id);
    if (!document) {
      res.status(404).json({ success: false, error: 'Document not found', details: [] });
      return;
    }

    try {
      await deleteFromR2(document.fileKey);
    } catch {
      // Best-effort: still remove the record if the object is already gone
    }
    await document.deleteOne();

    res.status(200).json({ success: true, data: document, message: 'Document deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, details: [] });
  }
};
