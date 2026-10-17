import express from 'express';
import employeeRoutes from './employeeRoutes';
import departmentRoutes from './departmentRoutes';
import jobTitleRoutes from './jobTitleRoutes';
import attendanceRoutes from './attendanceRoutes';
import leaveRoutes from './leaveRoutes';
import holidayRoutes from './holidayRoutes';
import payrollRoutes from './payrollRoutes';
import announcementRoutes from './announcementRoutes';
import dashboardRoutes from './dashboardRoutes';
import performanceRoutes from './performanceRoutes';
import trainingRoutes from './trainingRoutes';
import checklistRoutes from './checklistRoutes';
import documentRoutes from './documentRoutes';
import meRoutes from './meRoutes';
import authMiddleware from '../../middleware/auth';
import { anyHrReader, hrGuard } from '../middleware/hrPermission';

const router = express.Router();

// All HR routes require authentication
router.use(authMiddleware);

// Self-service routes: any authenticated user with a linked employee profile
router.use('/me', meRoutes);

// Each HR area is governed by its own sub-module permission (see config/permissionRegistry).
const LIST_OR_ONE = [/^\/?$/, /^\/[^/]+\/?$/];

router.use('/employees', hrGuard('hr.employees', {
  sharedReads: LIST_OR_ONE,
  rules: [
    { method: 'POST', path: /^\/[^/]+\/transfer\/?$/, action: 'update' },
    { method: 'POST', path: /^\/[^/]+\/upload-photo\/?$/, action: 'update' },
  ],
}), employeeRoutes);
router.use('/departments', hrGuard('hr.employees', { sharedReads: [/^\/?$/] }), departmentRoutes);
router.use('/jobtitles', hrGuard('hr.employees', { sharedReads: [/^\/?$/] }), jobTitleRoutes);
router.use('/documents', hrGuard('hr.employees'), documentRoutes);
router.use('/checklists', hrGuard('hr.employees', {
  rules: [{ method: 'PUT', path: /^\/[^/]+\/tasks\//, action: 'update' }],
}), checklistRoutes);

router.use('/attendance', hrGuard('hr.attendance', {
  rules: [{ method: 'POST', path: /^\/clockout\/?$/, action: 'update' }],
}), attendanceRoutes);

router.use('/leaves', hrGuard('hr.leave', {
  sharedReads: [/^\/types\/?$/],
  rules: [
    { method: 'PUT', path: /^\/requests\/[^/]+\/(approve|reject)\/?$/, action: 'approve' },
  ],
}), leaveRoutes);
router.use('/holidays', hrGuard('hr.leave', { sharedReads: [/^\/?$/] }), holidayRoutes);

router.use('/payroll', hrGuard('hr.payroll', {
  rules: [
    { method: 'POST', path: /^\/structure\/?$/, action: 'update' },
    { method: 'PUT', path: /^\/runs\/[^/]+\/(approve|mark-paid)\/?$/, action: 'approve' },
  ],
}), payrollRoutes);

router.use('/performance', hrGuard('hr.performance'), performanceRoutes);
router.use('/training', hrGuard('hr.training'), trainingRoutes);
router.use('/announcements', hrGuard('hr.announcements'), announcementRoutes);
router.use('/dashboard', anyHrReader, dashboardRoutes);

export default router;
