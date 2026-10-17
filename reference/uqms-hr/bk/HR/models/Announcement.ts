import { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IAnnouncement extends Document {
  title: string;
  body: string;
  priority: 'Normal' | 'Important' | 'Urgent';
  publishDate: Date;
  expiryDate?: Date;
  isActive: boolean;
  // _id of the User in the primary app database (separate connection — no populate)
  createdBy?: string;
}

const announcementSchema = new Schema<IAnnouncement>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    priority: { type: String, enum: ['Normal', 'Important', 'Urgent'], default: 'Normal' },
    publishDate: { type: Date, default: Date.now },
    expiryDate: { type: Date },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String },
  },
  { timestamps: true }
);

const Announcement = hrDbConnection.model<IAnnouncement>('Announcement', announcementSchema);

export default Announcement;
