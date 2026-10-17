import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  IMPORT_KINDS,
  importCommitSchema,
  importRequestSchema,
  MAX_IMPORT_ROWS,
  ok,
  type ImportKind,
  type ImportTemplate,
  type PermissionKey,
} from '@hr/shared';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

import { employeeImport } from './employees';
import {
  commitImport,
  ImportBlockedError,
  previewImport,
  type ImportDefinition,
} from './framework';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
const DEFINITIONS: Record<ImportKind, ImportDefinition<any, any>> = {
  employees: employeeImport,
};

const PERMISSION: Record<ImportKind, PermissionKey> = { employees: 'employees.create' };

const kindParams = { params: z.object({ kind: z.enum(IMPORT_KINDS) }) };

/** Each import kind has its own permission (all scope). Runs after `validate(kindParams)`. */
const guardKind: RequestHandler = (req, res, next) =>
  requirePermission(PERMISSION[parsed(req, kindParams).params.kind], 'all')(req, res, next);

export function importRoutes(): Router {
  const router = Router();

  router.get('/imports/:kind/template', validate(kindParams), guardKind, (req, res) => {
    const { kind } = parsed(req, kindParams).params;
    const def = DEFINITIONS[kind];
    const body: ImportTemplate = {
      kind,
      title: def.title,
      fields: def.fields,
      maxRows: MAX_IMPORT_ROWS,
    };
    res.json(ok(body));
  });

  const previewSchemas = { ...kindParams, body: importRequestSchema };
  router.post('/imports/:kind/preview', validate(previewSchemas), guardKind, async (req, res) => {
    const { params, body } = parsed(req, previewSchemas);
    res.json(ok(await previewImport(authedCtx(req), DEFINITIONS[params.kind], body.rows)));
  });

  const commitSchemas = { ...kindParams, body: importCommitSchema };
  router.post('/imports/:kind/commit', validate(commitSchemas), guardKind, async (req, res) => {
    const { params, body } = parsed(req, commitSchemas);
    try {
      res.json(
        ok(
          await commitImport(authedCtx(req), DEFINITIONS[params.kind], body.rows, body.skipInvalid),
        ),
      );
    } catch (err) {
      if (err instanceof ImportBlockedError) {
        throw new AppError(400, 'VALIDATION_ERROR', err.message, err.preview);
      }
      throw err;
    }
  });

  return router;
}
