import { asc, sql } from 'drizzle-orm';
import { Router } from 'express';

import { schema } from '@hr/db';
import {
  branchInputSchema,
  costCenterInputSchema,
  departmentInputSchema,
  designationInputSchema,
  gradeInputSchema,
  type Branch,
  type CostCenter,
  type Department,
  type Designation,
  type Grade,
} from '@hr/shared';

import { AppError } from '../../lib/errors';

import { refCrudRoutes } from './refCrud';

const { branches, costCenters, departments, designations, grades } = schema;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Branches, departments (tree), grades, designations, cost centres. */
export function orgRoutes(): Router {
  const router = Router();

  router.use(
    refCrudRoutes({
      path: 'branches',
      entity: 'branches',
      table: branches,
      input: branchInputSchema,
      orderBy: asc(branches.name),
      toValues: (b) => ({
        ...b,
        geoLat: b.geoLat === null ? null : String(b.geoLat),
        geoLng: b.geoLng === null ? null : String(b.geoLng),
      }),
      toDto: (r): Branch => ({
        id: r.id,
        code: r.code as string,
        name: r.name as string,
        address: r.address as Branch['address'],
        calendarId: (r.calendarId as string | null) ?? null,
        geoLat: num(r.geoLat),
        geoLng: num(r.geoLng),
        geoRadiusM: (r.geoRadiusM as number | null) ?? null,
        allowedIps: (r.allowedIps as string[]) ?? [],
        archived: !!r.archivedAt,
      }),
    }),
  );

  router.use(
    refCrudRoutes({
      path: 'departments',
      entity: 'departments',
      table: departments,
      input: departmentInputSchema,
      orderBy: asc(departments.name),
      toDto: (r): Department => ({
        id: r.id,
        code: r.code as string,
        name: r.name as string,
        parentId: (r.parentId as string | null) ?? null,
        headEmployeeId: (r.headEmployeeId as string | null) ?? null,
        archived: !!r.archivedAt,
      }),
      // Keep the tree a tree: a department can't move under itself or its descendants.
      check: async (ctx, input, id) => {
        if (!id || !input.parentId) return;
        if (input.parentId === id)
          throw AppError.badRequest('A department cannot be its own parent');
        const [hit] = await ctx.db.execute<{ found: boolean }>(sql`
          with recursive sub(id) as (
            select id from departments where id = ${id}
            union
            select d.id from departments d join sub on d.parent_id = sub.id
          )
          select exists(select 1 from sub where id = ${input.parentId}) as found`);
        if (hit?.found) {
          throw AppError.badRequest(
            'That would put the department under one of its own sub-departments',
          );
        }
      },
    }),
  );

  router.use(
    refCrudRoutes({
      path: 'grades',
      entity: 'grades',
      table: grades,
      input: gradeInputSchema,
      orderBy: asc(grades.rank),
      toDto: (r): Grade => ({
        id: r.id,
        code: r.code as string,
        name: r.name as string,
        rank: r.rank as number,
        archived: !!r.archivedAt,
      }),
    }),
  );

  router.use(
    refCrudRoutes({
      path: 'designations',
      entity: 'designations',
      table: designations,
      input: designationInputSchema,
      orderBy: asc(designations.title),
      toDto: (r): Designation => ({
        id: r.id,
        title: r.title as string,
        gradeId: (r.gradeId as string | null) ?? null,
        archived: !!r.archivedAt,
      }),
    }),
  );

  router.use(
    refCrudRoutes({
      path: 'cost-centers',
      entity: 'cost_centers',
      table: costCenters,
      input: costCenterInputSchema,
      orderBy: asc(costCenters.code),
      toDto: (r): CostCenter => ({
        id: r.id,
        code: r.code as string,
        name: r.name as string,
        archived: !!r.archivedAt,
      }),
    }),
  );

  return router;
}
