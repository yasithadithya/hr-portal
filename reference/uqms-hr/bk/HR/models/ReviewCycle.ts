import { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IReviewCycle extends Document {
  name: string;
  type: 'Annual' | 'SemiAnnual' | 'Quarterly' | 'Probation';
  periodStart: Date;
  periodEnd: Date;
  status: 'Open' | 'Closed';
}

const reviewCycleSchema = new Schema<IReviewCycle>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: ['Annual', 'SemiAnnual', 'Quarterly', 'Probation'], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
  },
  { timestamps: true }
);

const ReviewCycle = hrDbConnection.model<IReviewCycle>('ReviewCycle', reviewCycleSchema);

export default ReviewCycle;
