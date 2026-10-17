import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IGoal extends Document {
  employee: mongoose.Types.ObjectId;
  cycle?: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  kpi?: string;
  targetValue?: string;
  weight: number;
  progress: number;
  status: 'NotStarted' | 'InProgress' | 'Completed' | 'Cancelled';
  dueDate?: Date;
}

const goalSchema = new Schema<IGoal>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    cycle: { type: Schema.Types.ObjectId, ref: 'ReviewCycle' },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    kpi: { type: String },
    targetValue: { type: String },
    weight: { type: Number, default: 0, min: 0, max: 100 },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: ['NotStarted', 'InProgress', 'Completed', 'Cancelled'], default: 'NotStarted' },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

const Goal = hrDbConnection.model<IGoal>('Goal', goalSchema);

export default Goal;
