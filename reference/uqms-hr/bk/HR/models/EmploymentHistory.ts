import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IEmploymentHistory extends Document {
  employee: mongoose.Types.ObjectId;
  jobTitle?: mongoose.Types.ObjectId;
  department?: mongoose.Types.ObjectId;
  startDate?: Date;
  endDate?: Date;
  reason?: string;
}

const employmentHistorySchema = new Schema<IEmploymentHistory>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    jobTitle: { type: Schema.Types.ObjectId, ref: 'JobTitle' },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    startDate: { type: Date },
    endDate: { type: Date },
    reason: { type: String },
  },
  { timestamps: true }
);

const EmploymentHistory = hrDbConnection.model<IEmploymentHistory>('EmploymentHistory', employmentHistorySchema);

export default EmploymentHistory;
