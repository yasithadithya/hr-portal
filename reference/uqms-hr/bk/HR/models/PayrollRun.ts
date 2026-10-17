import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IPayrollRun extends Document {
  employee: mongoose.Types.ObjectId;
  month: number;
  year: number;
  basicSalary: number;
  
  // Allowances
  totalAllowances: number;
  allowanceBreakdown: { name: string; amount: number }[];

  // Earnings
  overtimePay: number;
  grossSalary: number;

  // Sri Lanka Statutory Deductions
  epfEmployee: number;
  epfEmployer: number;
  etf: number;

  // Other Deductions
  incomeTax: number;
  otherDeductions: { name: string; amount: number }[];
  totalDeductions: number;

  // Net
  netSalary: number;

  // Attendance basis
  workingDaysInMonth: number;
  daysWorked: number;
  leaveDaysPaid: number;
  absentDays: number;
  overtimeHours: number;

  status: 'Draft' | 'Approved' | 'Paid';
  generatedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  paidAt?: Date;
}

const payrollRunSchema = new Schema<IPayrollRun>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    basicSalary: { type: Number, required: true },
    
    totalAllowances: { type: Number, default: 0 },
    allowanceBreakdown: [
      {
        name: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],

    overtimePay: { type: Number, default: 0 },
    grossSalary: { type: Number, required: true },

    epfEmployee: { type: Number, required: true },
    epfEmployer: { type: Number, required: true },
    etf: { type: Number, required: true },

    incomeTax: { type: Number, default: 0 },
    otherDeductions: [
      {
        name: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],
    totalDeductions: { type: Number, required: true },

    netSalary: { type: Number, required: true },

    workingDaysInMonth: { type: Number, required: true },
    daysWorked: { type: Number, required: true },
    leaveDaysPaid: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },

    status: { 
      type: String, 
      enum: ['Draft', 'Approved', 'Paid'],
      default: 'Draft'
    },
    generatedAt: { type: Date, default: Date.now },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'Employee' },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

const PayrollRun = hrDbConnection.model<IPayrollRun>('PayrollRun', payrollRunSchema);

export default PayrollRun;
