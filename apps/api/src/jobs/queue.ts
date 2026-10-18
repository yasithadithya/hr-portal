import PgBoss from 'pg-boss';
import type { Logger } from 'pino';

/**
 * Background jobs (CLAUDE.md stack: pg-boss on the control-plane database). Every tenant job's
 * payload carries `tenantId`; handlers resolve the tenant's own database from it.
 */
export const JOB_NAMES = ['notifications.deliver', 'daily.tenant', 'daily.sweep'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobData {
  tenantId?: string;
  [key: string]: unknown;
}
export type JobHandler = (data: JobData) => Promise<void>;
export type JobHandlers = Record<JobName, JobHandler>;

export interface JobQueue {
  send(name: JobName, data: JobData, opts?: { singletonKey?: string }): Promise<void>;
}

/**
 * Runs handlers in-process (tests and local runs without a worker). `drain()` waits for
 * everything sent so far; errors are collected rather than crashing the request.
 */
export class InlineQueue implements JobQueue {
  private handlers: Partial<JobHandlers> = {};
  private pending: Promise<void>[] = [];
  readonly errors: unknown[] = [];
  readonly sent: { name: JobName; data: JobData }[] = [];

  register(handlers: Partial<JobHandlers>) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  async send(name: JobName, data: JobData) {
    this.sent.push({ name, data });
    const h = this.handlers[name];
    if (!h) return;
    this.pending.push(
      h(data).catch((err: unknown) => {
        this.errors.push(err);
      }),
    );
  }

  async drain() {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
  }
}

/** pg-boss: durable, retried, with cron schedules (tenant timezone handled per job). */
export class PgBossQueue implements JobQueue {
  private constructor(private readonly boss: PgBoss) {}

  static async start(opts: {
    connectionString: string;
    handlers: JobHandlers;
    logger: Logger;
    /** Cron in Asia/Colombo for the daily sweep (fans out one job per tenant). */
    dailyCron: string;
  }): Promise<PgBossQueue> {
    const boss = new PgBoss({ connectionString: opts.connectionString, schema: 'pgboss' });
    boss.on('error', (err) => opts.logger.error({ err }, 'pg-boss error'));
    await boss.start();
    for (const name of JOB_NAMES) {
      await boss.createQueue(name);
      await boss.work<JobData>(name, { batchSize: 1 }, async ([job]) => {
        if (job) await opts.handlers[name](job.data);
      });
    }
    await boss.schedule('daily.sweep', opts.dailyCron, {}, { tz: 'Asia/Colombo' });
    opts.logger.info('Job worker started');
    return new PgBossQueue(boss);
  }

  async send(name: JobName, data: JobData, opts: { singletonKey?: string } = {}) {
    await this.boss.send(name, data, {
      retryLimit: 3,
      retryBackoff: true,
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
    });
  }

  async stop() {
    await this.boss.stop({ graceful: true });
  }
}
