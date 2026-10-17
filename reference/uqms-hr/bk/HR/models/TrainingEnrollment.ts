import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ITrainingEnrollment extends Document {
  session: mongoose.Types.ObjectId;
  employee: mongoose.Types.ObjectId;
  status: 'Enrolled' | 'Completed' | 'Failed' | 'NoShow' | 'Cancelled';
  score?: number;
  result?: string;
  completedAt?: Date;
}

const trainingEnrollmentSchema = new Schema<ITrainingEnrollment>(
  {
    session: { type: Schema.Types.ObjectId, ref: 'TrainingSession', required: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    status: { type: String, enum: ['Enrolled', 'Completed', 'Failed', 'NoShow', 'Cancelled'], default: 'Enrolled' },
    score: { type: Number },
    result: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

trainingEnrollmentSchema.index({ session: 1, employee: 1 }, { unique: true });

const TrainingEnrollment = hrDbConnection.model<ITrainingEnrollment>('TrainingEnrollment', trainingEnrollmentSchema);

export default TrainingEnrollment;
