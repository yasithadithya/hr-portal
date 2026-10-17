import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IEmployeeDocument extends Document {
  employee: mongoose.Types.ObjectId;
  category: 'NIC' | 'Passport' | 'Contract' | 'Certificate' | 'Medical' | 'Other';
  title: string;
  fileKey: string;
  fileUrl?: string;
  contentType?: string;
  size?: number;
  expiryDate?: Date;
  // _id of the User in the primary app database (separate connection — no populate)
  uploadedBy?: string;
  notes?: string;
}

const employeeDocumentSchema = new Schema<IEmployeeDocument>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    category: { type: String, enum: ['NIC', 'Passport', 'Contract', 'Certificate', 'Medical', 'Other'], default: 'Other' },
    title: { type: String, required: true, trim: true },
    fileKey: { type: String, required: true },
    fileUrl: { type: String },
    contentType: { type: String },
    size: { type: Number },
    expiryDate: { type: Date },
    uploadedBy: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

const EmployeeDocument = hrDbConnection.model<IEmployeeDocument>('EmployeeDocument', employeeDocumentSchema);

export default EmployeeDocument;
