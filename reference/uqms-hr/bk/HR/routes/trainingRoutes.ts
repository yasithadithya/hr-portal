import express from 'express';
import {
  getPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  getSessions,
  createSession,
  updateSession,
  getSessionEnrollments,
  enrollEmployee,
  updateEnrollment,
  deleteEnrollment,
  getEmployeeTrainings,
} from '../controllers/trainingController';

const router = express.Router();

router.get('/programs', getPrograms);
router.post('/programs', createProgram);
router.put('/programs/:id', updateProgram);
router.delete('/programs/:id', deleteProgram);

router.get('/sessions', getSessions);
router.post('/sessions', createSession);
router.put('/sessions/:id', updateSession);

router.get('/sessions/:id/enrollments', getSessionEnrollments);
router.post('/sessions/:id/enroll', enrollEmployee);
router.put('/enrollments/:id', updateEnrollment);
router.delete('/enrollments/:id', deleteEnrollment);

router.get('/employee/:employeeId', getEmployeeTrainings);

export default router;
