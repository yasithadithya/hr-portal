import express from 'express';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createChecklist,
  getChecklists,
  updateChecklistTask,
  deleteChecklist,
} from '../controllers/checklistController';

const router = express.Router();

router.get('/templates', getTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

router.get('/', getChecklists);
router.post('/', createChecklist);
router.put('/:id/tasks/:taskIndex', updateChecklistTask);
router.delete('/:id', deleteChecklist);

export default router;
