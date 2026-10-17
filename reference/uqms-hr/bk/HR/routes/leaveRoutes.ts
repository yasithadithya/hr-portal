import express from 'express';
import {
  getLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  getLeaveBalance,
  getAllBalances,
  submitLeaveRequest,
  getLeaveRequests,
  approveRequest,
  rejectRequest,
  cancelRequest,
  initializeBalances,
} from '../controllers/leaveController';

const router = express.Router();

router.get('/types', getLeaveTypes);
router.post('/types', createLeaveType);
router.put('/types/:id', updateLeaveType);
router.delete('/types/:id', deleteLeaveType);

router.get('/balances', getAllBalances);
router.post('/balance/initialize', initializeBalances);
router.get('/balance/:employeeId', getLeaveBalance);

router.post('/request', submitLeaveRequest);
router.get('/requests', getLeaveRequests);

router.put('/requests/:id/approve', approveRequest);
router.put('/requests/:id/reject', rejectRequest);
router.put('/requests/:id/cancel', cancelRequest);

export default router;
