import express from 'express';
import {
  clockIn,
  clockOut,
  getAttendance,
  getSummary,
  manualEntry,
} from '../controllers/attendanceController';

const router = express.Router();

router.post('/clockin', clockIn);
router.post('/clockout', clockOut);
router.post('/manual', manualEntry);
router.get('/summary/:employeeId', getSummary);
router.get('/', getAttendance);
router.get('/:employeeId', getAttendance);

export default router;
