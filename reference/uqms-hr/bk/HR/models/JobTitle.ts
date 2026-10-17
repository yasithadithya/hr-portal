import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IJobTitle extends Document {
  title: string;
  grade?: string;
  description?: string;
}

const jobTitleSchema = new Schema<IJobTitle>(
  {
    title: { type: String, required: true, unique: true },
    grade: { type: String },
    description: { type: String },
  },
  { timestamps: true }
);

const JobTitle = hrDbConnection.model<IJobTitle>('JobTitle', jobTitleSchema);

export default JobTitle;
