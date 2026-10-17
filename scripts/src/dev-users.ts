import { createClient } from '@supabase/supabase-js';

import { findTenantBySlug, getTenantConnection } from '@hr/control-db';
import { connect } from '@hr/db';

import { log, main, masterKey, openControl } from './lib';

/**
 * pnpm dev:users — LOCAL ONLY. Creates sign-in-ready demo users on the `dev` tenant:
 * owner, HR admin, payroll admin, a manager and two employees (one reporting to the manager).
 * Passwords are fixed and printed; this refuses to run against non-local Supabase.
 */
const PASSWORD = 'Password123!';

const PEOPLE = [
  { email: 'owner@dev.local', roles: ['owner'], emp: ['DEV-0001', 'Olivia', 'Owner', null] },
  {
    email: 'hr@dev.local',
    roles: ['hr_admin', 'employee'],
    emp: ['DEV-0002', 'Hasini', 'Perera', 'DEV-0001'],
  },
  {
    email: 'payroll@dev.local',
    roles: ['payroll_admin'],
    emp: ['DEV-0003', 'Pradeep', 'Silva', 'DEV-0001'],
  },
  {
    email: 'manager@dev.local',
    roles: ['manager'],
    emp: ['DEV-0004', 'Malith', 'Fernando', 'DEV-0001'],
  },
  {
    email: 'employee@dev.local',
    roles: ['employee'],
    emp: ['DEV-0005', 'Esha', 'Jayasuriya', 'DEV-0004'],
  },
  {
    email: 'employee2@dev.local',
    roles: ['employee'],
    emp: ['DEV-0006', 'Kasun', 'Bandara', 'DEV-0001'],
  },
] as const;

await main(async () => {
  const { sql: csql, db } = openControl();
  try {
    const tenant = await findTenantBySlug(db, 'dev');
    if (!tenant) throw new Error('No "dev" tenant. Run `pnpm dev:setup` first.');
    const conn = await getTenantConnection(db, tenant, masterKey());
    if (
      !conn.supabaseUrl ||
      !/127\.0\.0\.1|localhost/.test(conn.supabaseUrl) ||
      !conn.serviceRoleKey
    ) {
      throw new Error('Refusing: dev:users only targets a local Supabase');
    }
    const supabase = createClient(conn.supabaseUrl, conn.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;

    const sql = connect(conn.dbDirectUrl, { max: 1 });
    try {
      for (const p of PEOPLE) {
        const [no, first, last, managerNo] = p.emp;
        const [emp] = await sql`
          insert into employees (employee_no, first_name, last_name, work_email, join_date, reports_to_id)
          values (${no}, ${first}, ${last}, ${p.email}, '2024-01-01',
                  (select id from employees where employee_no = ${managerNo}))
          on conflict (employee_no) do update set work_email = excluded.work_email
          returning id, reports_to_id`;
        await sql`
          insert into employee_job_history (employee_id, effective_from, reports_to_id, employment_type, reason)
          values (${emp!.id}, '2024-01-01', ${emp!.reports_to_id}, 'permanent', 'hire')
          on conflict (employee_id, effective_from) do nothing`;

        let authId = list.users.find((u) => u.email === p.email)?.id;
        if (authId) {
          await supabase.auth.admin.updateUserById(authId, {
            password: PASSWORD,
            email_confirm: true,
          });
        } else {
          const { data, error } = await supabase.auth.admin.createUser({
            email: p.email,
            password: PASSWORD,
            email_confirm: true,
          });
          if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
          authId = data.user.id;
        }

        const [u] = await sql`
          insert into app_users (email, auth_user_id, employee_id, status)
          values (${p.email}, ${authId}, ${emp!.id}, 'active')
          on conflict (email) do update set auth_user_id = excluded.auth_user_id,
            employee_id = excluded.employee_id, status = 'active'
          returning id`;
        await sql`delete from user_roles where user_id = ${u!.id}`;
        for (const r of p.roles) {
          await sql`insert into user_roles (user_id, role_id) select ${u!.id}, id from roles where key = ${r}`;
        }
        log(`✔ ${p.email.padEnd(22)} ${p.roles.join(', ')}`);
      }
    } finally {
      await sql.end();
    }
    log(`\nPassword for all: ${PASSWORD}  →  http://localhost:3000/login`);
  } finally {
    await csql.end();
  }
});
