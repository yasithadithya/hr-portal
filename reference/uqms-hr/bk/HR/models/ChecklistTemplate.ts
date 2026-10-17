import { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IChecklistTemplateItem {
  title: string;
  description?: string;
  dueOffsetDays: number;
}

export interface IChecklistTemplate extends Document {
  name: string;
  type: 'Onboarding' | 'Offboarding';
  items: IChecklistTemplateItem[];
  isActive: boolean;
}

const checklistTemplateSchema = new Schema<IChecklistTemplate>(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['Onboarding', 'Offboarding'], required: true },
    items: [
      {
        title: { type: String, required: true },
        description: { type: String },
        dueOffsetDays: { type: Number, default: 0 },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const ChecklistTemplate = hrDbConnection.model<IChecklistTemplate>('ChecklistTemplate', checklistTemplateSchema);

export default ChecklistTemplate;
