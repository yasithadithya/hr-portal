import { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ITrainingProgram extends Document {
  name: string;
  description?: string;
  category?: string;
  provider?: string;
  durationHours?: number;
  isActive: boolean;
}

const trainingProgramSchema = new Schema<ITrainingProgram>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String },
    category: { type: String },
    provider: { type: String },
    durationHours: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const TrainingProgram = hrDbConnection.model<ITrainingProgram>('TrainingProgram', trainingProgramSchema);

export default TrainingProgram;
