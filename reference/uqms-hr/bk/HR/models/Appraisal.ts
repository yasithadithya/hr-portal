import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IAppraisal extends Document {
  employee: mongoose.Types.ObjectId;
  cycle: mongoose.Types.ObjectId;
  reviewer: mongoose.Types.ObjectId;
  ratings: { criteria: string; rating: number; comments?: string }[];
  overallRating?: number;
  strengths?: string;
  areasForImprovement?: string;
  reviewerComments?: string;
  employeeComments?: string;
  status: 'Draft' | 'Submitted' | 'Acknowledged';
  submittedAt?: Date;
  acknowledgedAt?: Date;
}

const appraisalSchema = new Schema<IAppraisal>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    cycle: { type: Schema.Types.ObjectId, ref: 'ReviewCycle', required: true },
    reviewer: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    ratings: [
      {
        criteria: { type: String, required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        comments: { type: String },
      },
    ],
    overallRating: { type: Number, min: 1, max: 5 },
    strengths: { type: String },
    areasForImprovement: { type: String },
    reviewerComments: { type: String },
    employeeComments: { type: String },
    status: { type: String, enum: ['Draft', 'Submitted', 'Acknowledged'], default: 'Draft' },
    submittedAt: { type: Date },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

appraisalSchema.index({ employee: 1, cycle: 1 }, { unique: true });

const Appraisal = hrDbConnection.model<IAppraisal>('Appraisal', appraisalSchema);

export default Appraisal;
