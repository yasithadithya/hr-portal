import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ILeaveBalance extends Document {
  employee: mongoose.Types.ObjectId;
  leaveType: mongoose.Types.ObjectId;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

const leaveBalanceSchema = new Schema<ILeaveBalance>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    year: { type: Number, required: true },
    totalDays: { type: Number, required: true, default: 0 },
    usedDays: { type: Number, required: true, default: 0 },
    pendingDays: { type: Number, required: true, default: 0 },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

leaveBalanceSchema.virtual('remainingDays').get(function (this: ILeaveBalance) {
  return this.totalDays - this.usedDays - this.pendingDays;
});

const LeaveBalance = hrDbConnection.model<ILeaveBalance>('LeaveBalance', leaveBalanceSchema);

export default LeaveBalance;
