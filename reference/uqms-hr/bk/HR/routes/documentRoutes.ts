import express from 'express';
import multer from 'multer';
import {
  uploadDocument,
  getEmployeeDocuments,
  getExpiringDocuments,
  deleteDocument,
} from '../controllers/documentController';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.get('/expiring', getExpiringDocuments);
router.delete('/doc/:id', deleteDocument);
router.get('/:employeeId', getEmployeeDocuments);
router.post('/:employeeId', upload.single('file'), uploadDocument);

export default router;
