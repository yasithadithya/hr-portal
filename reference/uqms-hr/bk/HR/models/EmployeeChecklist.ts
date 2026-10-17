import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IChecklistTask {
  title: string;
  description?: string;
  assignee?: mongoose.Types.ObjectId;
  dueDate?: Date;
  status: 'Pending' | 'InProgress' | 'Done' | 'Skipped';
  completedAt?: Date;
  notes?: string;
}

export interface IEmployeeChecklist extends Document {
  employee: mongoose.Types.ObjectId;
  template?: mongoose.Types.ObjectId;
  type: 'Onboarding' | 'Offboarding';
  startDate: Date;
  status: 'InProgress' | 'Completed';
  // Snapshot of the template items at creation time — template edits don't mutate live checklists
  tasks: IChecklistTask[];
}

const employeeChecklistSchema = new Schema<IEmployeeChecklist>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    template: { type: Schema.Types.ObjectId, ref: 'ChecklistTemplate' },
    type: { type: String, enum: ['Onboarding', 'Offboarding'], required: true },
    startDate: { type: Date, required: true },
    status: { type: String, enum: ['InProgress', 'Completed'], default: 'InProgress' },
    tasks: [
      {
        title: { type: String, required: true },
        description: { type: String },
        assignee: { type: Schema.Types.ObjectId, ref: 'Employee' },
        dueDate: { type: Date },
        status: { type: String, enum: ['Pending', 'InProgress', 'Done', 'Skipped'], default: 'Pending' },
        completedAt: { type: Date },
        notes: { type: String },
      },
    ],
  },
  { timestamps: true }
);

const EmployeeChecklist = hrDbConnection.model<IEmployeeChecklist>('EmployeeChecklist', employeeChecklistSchema);

export default EmployeeChecklist;
