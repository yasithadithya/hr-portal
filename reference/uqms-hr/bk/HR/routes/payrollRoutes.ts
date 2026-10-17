import express from 'express';
import {
  setSalaryStructure,
  getSalaryStructure,
  generateSinglePayroll,
  generateBulkPayroll,
  listPayrollRuns,
  getPayrollRun,
  approvePayrollRun,
  markPayrollPaid,
  generatePayslip,
  getPayrollSummary,
} from '../controllers/payrollController';

const router = express.Router();

router.post('/structure', setSalaryStructure);
router.get('/structure/:employeeId', getSalaryStructure);

router.post('/generate', generateSinglePayroll);
router.post('/generate/bulk', generateBulkPayroll);

router.get('/summary', getPayrollSummary);
router.get('/runs', listPayrollRuns);
router.get('/runs/:id', getPayrollRun);

router.put('/runs/:id/approve', approvePayrollRun);
router.put('/runs/:id/mark-paid', markPayrollPaid);
router.get('/payslip/:id', generatePayslip);

export default router;
