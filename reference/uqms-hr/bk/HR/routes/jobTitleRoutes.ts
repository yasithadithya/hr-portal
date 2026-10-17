import express from 'express';
import {
  getJobTitles,
  createJobTitle,
  updateJobTitle,
  deleteJobTitle,
} from '../controllers/jobTitleController';

const router = express.Router();

router.get('/', getJobTitles);
router.post('/', createJobTitle);
router.put('/:id', updateJobTitle);
router.delete('/:id', deleteJobTitle);

export default router;
