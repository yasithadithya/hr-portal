import express from 'express';
import {
  getMyProfile,
  getMyPayslips,
  getMyPayslip,
  getMyLeaveBalance,
  getMyLeaveRequests,
  submitMyLeaveRequest,
  cancelMyLeaveRequest,
  myClockIn,
  myClockOut,
  getMyAttendance,
  getMyAppraisals,
  acknowledgeMyAppraisal,
  getMyTrainings,
  getMyAnnouncements,
} from '../controllers/meController';

const router = express.Router();

router.get('/profile', getMyProfile);

router.get('/payslips', getMyPayslips);
router.get('/payslips/:id', getMyPayslip);

router.get('/leaves/balance', getMyLeaveBalance);
router.get('/leaves/requests', getMyLeaveRequests);
router.post('/leaves/request', submitMyLeaveRequest);
router.put('/leaves/requests/:id/cancel', cancelMyLeaveRequest);

router.post('/attendance/clockin', myClockIn);
router.post('/attendance/clockout', myClockOut);
router.get('/attendance', getMyAttendance);

router.get('/appraisals', getMyAppraisals);
router.put('/appraisals/:id/acknowledge', acknowledgeMyAppraisal);

router.get('/trainings', getMyTrainings);

router.get('/announcements', getMyAnnouncements);

export default router;
