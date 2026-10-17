import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ILeaveRequest extends Document {
  employee: mongoose.Types.ObjectId;
  leaveType: mongoose.Types.ObjectId;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  reason?: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectionReason?: string;
}

const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    reason: { type: String },
    status: { 
      type: String, 
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending'
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
    approvedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

const LeaveRequest = hrDbConnection.model<ILeaveRequest>('LeaveRequest', leaveRequestSchema);

export default LeaveRequest;
