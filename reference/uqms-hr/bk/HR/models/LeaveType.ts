import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ILeaveType extends Document {
  name: string;
  defaultDaysPerYear: number;
  isCarryForwardAllowed: boolean;
  maxCarryForwardDays?: number;
  isPaidLeave: boolean;
}

const leaveTypeSchema = new Schema<ILeaveType>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    defaultDaysPerYear: { type: Number, required: true },
    isCarryForwardAllowed: { type: Boolean, default: false },
    maxCarryForwardDays: { type: Number },
    isPaidLeave: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const LeaveType = hrDbConnection.model<ILeaveType>('LeaveType', leaveTypeSchema);

export default LeaveType;
