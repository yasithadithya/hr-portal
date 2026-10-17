import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IPublicHoliday extends Document {
  date: Date;
  name: string;
  isRecurring: boolean;
}

const publicHolidaySchema = new Schema<IPublicHoliday>(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true },
    isRecurring: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PublicHoliday = hrDbConnection.model<IPublicHoliday>('PublicHoliday', publicHolidaySchema);

export default PublicHoliday;
