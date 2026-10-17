import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface ISalaryStructure extends Document {
  employee: mongoose.Types.ObjectId;
  basicSalary: number;
  allowances: {
    name: string;
    amount: number;
    isTaxable: boolean;
  }[];
  effectiveFrom: Date;
  isActive: boolean;
}

const salaryStructureSchema = new Schema<ISalaryStructure>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    basicSalary: { type: Number, required: true },
    allowances: [
      {
        name: { type: String, required: true },
        amount: { type: Number, required: true },
        isTaxable: { type: Boolean, default: false },
      },
    ],
    effectiveFrom: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SalaryStructure = hrDbConnection.model<ISalaryStructure>('SalaryStructure', salaryStructureSchema);

export default SalaryStructure;
