import mongoose, { Document, Schema } from 'mongoose';
import hrDbConnection from '../config/hrDb';

export interface IEmployee extends Document {
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nic: string;
  dateOfBirth?: Date;
  gender?: 'Male' | 'Female' | 'Other';
  maritalStatus?: 'Single' | 'Married' | 'Divorced' | 'Widowed';
  personalEmail?: string;
  companyEmail: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    district?: string;
    province?: string;
    postalCode?: string;
  };
  profilePhotoUrl?: string;
  department?: mongoose.Types.ObjectId;
  jobTitle?: mongoose.Types.ObjectId;
  employmentType?: 'Permanent' | 'Contract' | 'Intern' | 'PartTime';
  employmentStatus?: 'Active' | 'Resigned' | 'Terminated' | 'OnProbation';
  joinedDate?: Date;
  probationEndDate?: Date;
  confirmationDate?: Date;
  reportsTo?: mongoose.Types.ObjectId;
  emergencyContact?: {
    name?: string;
    relationship?: string;
    phone?: string;
  };
  // _id of the User in the primary app database (separate connection — no populate)
  userId?: string;
  isDeleted: boolean;
}

const employeeSchema = new Schema<IEmployee>(
  {
    employeeId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    nic: { type: String, required: true, unique: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },
    personalEmail: { type: String },
    companyEmail: { type: String, required: true, unique: true },
    phone: { type: String },
    address: {
      street: { type: String },
      city: { type: String },
      district: { type: String },
      province: { type: String },
      postalCode: { type: String },
    },
    profilePhotoUrl: { type: String },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    jobTitle: { type: Schema.Types.ObjectId, ref: 'JobTitle' },
    employmentType: { type: String, enum: ['Permanent', 'Contract', 'Intern', 'PartTime'] },
    employmentStatus: { type: String, enum: ['Active', 'Resigned', 'Terminated', 'OnProbation'], default: 'Active' },
    joinedDate: { type: Date },
    probationEndDate: { type: Date },
    confirmationDate: { type: Date },
    reportsTo: { type: Schema.Types.ObjectId, ref: 'Employee' },
    emergencyContact: {
      name: { type: String },
      relationship: { type: String },
      phone: { type: String },
    },
    userId: { type: String, index: true },
    isDeleted: { type: Boolean, default: false },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

employeeSchema.virtual('fullName').get(function (this: IEmployee) {
  return `${this.firstName} ${this.lastName}`;
});

const Employee = hrDbConnection.model<IEmployee>('Employee', employeeSchema);

export default Employee;
