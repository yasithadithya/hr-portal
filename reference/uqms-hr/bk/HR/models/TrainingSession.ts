import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ITrainingSession extends Document {
  program: mongoose.Types.ObjectId;
  startDate: Date;
  endDate?: Date;
  trainer?: string;
  location?: string;
  capacity?: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  notes?: string;
}

const trainingSessionSchema = new Schema<ITrainingSession>(
  {
    program: { type: Schema.Types.ObjectId, ref: 'TrainingProgram', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    trainer: { type: String },
    location: { type: String },
    capacity: { type: Number },
    status: { type: String, enum: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled' },
    notes: { type: String },
  },
  { timestamps: true }
);

const TrainingSession = hrDbConnection.model<ITrainingSession>('TrainingSession', trainingSessionSchema);

export default TrainingSession;
