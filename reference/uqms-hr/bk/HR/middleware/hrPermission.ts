import { Response, NextFunction, RequestHandler } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { rejectUnlessCan } from '../../middleware/permission';
import { userCanAny } from '../../utils/permissions';
import { HR_KEYS } from '../../config/permissionRegistry';

type Rule = { method: string; path: RegExp; action: string };

interface HrGuardOptions {
  /** Routes needing an action other than the HTTP-method default (e.g. approvals). */
  rules?: Rule[];
  /** GET routes that any HR sub-module reader may use, because other HR screens use them as lookups. */
  sharedReads?: RegExp[];
}

const METHOD_ACTIONS: Record<string, string> = { GET: 'read', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

/**
 * Guards one HR area with its sub-module (e.g. `hr.leave`). The action defaults to the HTTP method
 * (GET=read, POST=create, PUT=update, DELETE=delete) unless a rule overrides it.
 */
export const hrGuard = (moduleKey: string, options: HrGuardOptions = {}): RequestHandler =>
  (async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.method === 'GET' && options.sharedReads?.some((re) => re.test(req.path))) {
        if (await userCanAny(req, HR_KEYS, ['read'])) {
          next();
          return;
        }
      }
      const rule = options.rules?.find((r) => r.method === req.method && r.path.test(req.path));
      const action = rule?.action ?? METHOD_ACTIONS[req.method] ?? 'update';
      if (await rejectUnlessCan(req, res, moduleKey, action)) return;
      next();
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Error checking permissions.', error: error.message });
    }
  }) as RequestHandler;

/** Requires read on at least one HR sub-module (e.g. for the HR dashboard). */
export const anyHrReader: RequestHandler = (async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (await userCanAny(req, HR_KEYS, ['read'])) {
      next();
      return;
    }
    res.status(403).json({ success: false, message: 'You do not have access to HR administration.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error checking permissions.', error: error.message });
  }
}) as RequestHandler;
