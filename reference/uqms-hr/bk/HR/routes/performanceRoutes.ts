import express from 'express';
import {
  getReviewCycles,
  createReviewCycle,
  updateReviewCycle,
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  getAppraisals,
  createAppraisal,
  updateAppraisal,
  submitAppraisal,
  acknowledgeAppraisal,
} from '../controllers/performanceController';

const router = express.Router();

router.get('/cycles', getReviewCycles);
router.post('/cycles', createReviewCycle);
router.put('/cycles/:id', updateReviewCycle);

router.get('/goals', getGoals);
router.post('/goals', createGoal);
router.put('/goals/:id', updateGoal);
router.delete('/goals/:id', deleteGoal);

router.get('/appraisals', getAppraisals);
router.post('/appraisals', createAppraisal);
router.put('/appraisals/:id/submit', submitAppraisal);
router.put('/appraisals/:id/acknowledge', acknowledgeAppraisal);
router.put('/appraisals/:id', updateAppraisal);

export default router;
