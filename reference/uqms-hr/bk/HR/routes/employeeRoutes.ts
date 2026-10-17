import express from 'express';
import multer from 'multer';
import {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeHistory,
  transferEmployee,
  uploadPhoto,
} from '../controllers/employeeController';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get('/', getEmployees);
router.post('/', createEmployee);

router.get('/:id', getEmployeeById);
router.put('/:id', updateEmployee);
router.delete('/:id', deleteEmployee);

router.get('/:id/history', getEmployeeHistory);
router.post('/:id/transfer', transferEmployee);
router.post('/:id/upload-photo', upload.single('photo'), uploadPhoto);

export default router;
