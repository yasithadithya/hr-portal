import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { healthSchema } from '@hr/shared';

import { createApp } from './app';
import { loadEnv } from './env';
import { AppError } from './lib/errors';
import { parsed, validate } from './middleware/validate';

const env = loadEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'http://allowed.test' });

const echoSchemas = {
  params: z.object({ id: z.uuid() }),
  body: z.object({ name: z.string().min(1) }),
};

const app = createApp({
  env,
  logger: pino({ level: 'silent' }),
  mount: (a) => {
    a.post('/echo/:id', validate(echoSchemas), (req, res) => {
      const { params, body } = parsed(req, echoSchemas);
      res.json({ success: true, data: { id: params.id, name: body.name } });
    });
    a.get('/boom', () => {
      throw new Error('kaboom');
    });
    a.get('/forbidden', async () => {
      throw AppError.forbidden();
    });
  },
});

describe('api skeleton', () => {
  it('GET /health returns the success envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(healthSchema.parse(res.body.data).status).toBe('ok');
  });

  it('unknown routes return a NOT_FOUND envelope', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('invalid input returns a VALIDATION_ERROR envelope', async () => {
    const res = await request(app).post('/echo/not-a-uuid').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(res.body.error.details).toBeDefined();
  });

  it('valid input reaches the handler typed', async () => {
    const id = '0b6f1f3e-6a43-4c55-9d43-2f7f0d6a1c11';
    const res = await request(app).post(`/echo/${id}`).send({ name: 'Nimal' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id, name: 'Nimal' } });
  });

  it('malformed JSON returns BAD_REQUEST', async () => {
    const res = await request(app)
      .post('/echo/0b6f1f3e-6a43-4c55-9d43-2f7f0d6a1c11')
      .set('content-type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('AppError and unexpected errors map to envelopes', async () => {
    const forbidden = await request(app).get('/forbidden');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const boom = await request(app).get('/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('echoes a safe incoming request id, otherwise generates one', async () => {
    const reused = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(reused.headers['x-request-id']).toBe('abc-123');

    const generated = await request(app).get('/health').set('x-request-id', '<script>');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CORS allows listed origins only', async () => {
    const allowed = await request(app).get('/health').set('origin', 'http://allowed.test');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://allowed.test');

    const denied = await request(app).get('/health').set('origin', 'http://evil.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('hides internal error messages in production', async () => {
    const prod = createApp({
      env: { ...env, NODE_ENV: 'production' },
      logger: pino({ level: 'silent' }),
      mount: (a) =>
        a.get('/boom', () => {
          throw new Error('secret detail');
        }),
    });
    const res = await request(prod).get('/boom');
    expect(res.body.error.message).toBe('Internal server error');
  });
});
