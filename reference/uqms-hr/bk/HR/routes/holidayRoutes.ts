import express from 'express';
import {
  getHolidays,
  addHoliday,
  updateHoliday,
  removeHoliday,
} from '../controllers/holidayController';

const router = express.Router();

router.get('/', getHolidays);
router.post('/', addHoliday);
router.put('/:id', updateHoliday);
router.delete('/:id', removeHoliday);

export default router;
