import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IAttendanceLog extends Document {
  employee: mongoose.Types.ObjectId;
  date: Date;
  clockIn?: Date;
  clockOut?: Date;
  workedHours?: number;
  overtimeHours?: number;
  status: 'Present' | 'Absent' | 'Late' | 'HalfDay' | 'OnLeave' | 'Holiday';
  isManualEntry: boolean;
  enteredBy?: mongoose.Types.ObjectId;
  notes?: string;
}

const attendanceLogSchema = new Schema<IAttendanceLog>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    clockIn: { type: Date },
    clockOut: { type: Date },
    workedHours: { type: Number },
    overtimeHours: { type: Number },
    status: { 
      type: String, 
      enum: ['Present', 'Absent', 'Late', 'HalfDay', 'OnLeave', 'Holiday'],
      required: true
    },
    isManualEntry: { type: Boolean, default: false },
    enteredBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
    notes: { type: String },
  },
  { timestamps: true }
);

const AttendanceLog = hrDbConnection.model<IAttendanceLog>('AttendanceLog', attendanceLogSchema);

export default AttendanceLog;
