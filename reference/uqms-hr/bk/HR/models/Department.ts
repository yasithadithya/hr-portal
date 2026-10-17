import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IDepartment extends Document {
  name: string;
  description?: string;
  headOfDepartment?: mongoose.Types.ObjectId;
}

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String },
    headOfDepartment: { type: Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

const Department = hrDbConnection.model<IDepartment>('Department', departmentSchema);

export default Department;
