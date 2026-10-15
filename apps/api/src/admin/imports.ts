// Spreadsheet imports (phase-2-plan §3.7). The browser dry-runs the file,
// creates a job, stages its chunks (one JSON file each in R2, deleted by the
// tmp-uploads lifecycle rule after a day), starts it, and follows progress;
// the queue consumer (jobs.ts) does the work, one chunk per message.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cancelImport,
  completeImportImage,
  createImportJob,
  getImportJob,
  type ImportMessage,
  listImportErrors,
  listImportImages,
  listImportJobs,
  runIdempotent,
  startImport,
  unstartImport,
} from '@managemind/core';
import { AppError, objectKey } from '@managemind/shared';
import type { Context } from 'hono';
import { inStore, type StaffEnv } from './context';

/** A staged chunk's size limit: 10 products of up to 100 variants fit comfortably. */
export const MAX_CHUNK_BYTES = 1024 * 1024;

export const chunkKey = (tenantId: string, jobId: string, n: number) =>
  objectKey('tmp-upload', tenantId, `imports/${jobId}/${n}.json`);

const Job = z
  .object({
    id: z.uuid(),
    status: z.enum(['staging', 'running', 'images', 'done', 'failed', 'cancelled']),
    fileName: z.string(),
    chunkCount: z.number().int(),
    nextChunk: z.number().int(),
    total: z.number().int(),
    processed: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    failed: z.number().int(),
    errorCount: z.number().int(),
    withStock: z.boolean(),
    withCost: z.boolean(),
    lastError: z.string().nullable(),
    images: z.object({
      pending: z.number().int(),
      done: z.number().int(),
      failed: z.number().int(),
    }),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi('ImportJob');
const Id = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['imports'] } as C & {
    tags: string[];
  });

export const IMPORT_ROUTES = {
  imports: r({
    method: 'get',
    path: '/imports',
    summary: 'The latest imports (catalog.read)',
    responses: json(z.array(Job), 'Imports'),
  }),
  createImport: r({
    method: 'post',
    path: '/imports',
    summary:
      'Create an import job (catalog.write; stock columns need inventory.write; accepts Idempotency-Key)',
    request: body(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        chunkCount: z.number().int().min(1).max(1000),
        total: z.number().int().min(1).max(100_000),
        stock: z.boolean().optional(),
      }),
    ),
    responses: {
      201: { content: { 'application/json': { schema: Job } }, description: 'Created' },
    },
  }),
  importJob: r({
    method: 'get',
    path: '/imports/{id}',
    summary: 'An import’s progress (catalog.read)',
    request: { params: Id },
    responses: json(Job, 'Import'),
  }),
  stageChunk: r({
    method: 'put',
    path: '/imports/{id}/chunks/{n}',
    summary: 'Stage one chunk of products (the dry run’s output; at most 1 MB)',
    request: {
      params: z.object({ id: z.uuid(), n: z.coerce.number().int().min(0).max(999) }),
      ...body(z.array(z.unknown()).min(1).max(100)),
    },
    responses: { 204: { description: 'Staged' } },
  }),
  startImport: r({
    method: 'post',
    path: '/imports/{id}/start',
    summary: 'Start processing once every chunk is staged (catalog.write)',
    request: { params: Id },
    responses: json(Job, 'Import'),
  }),
  cancelImport: r({
    method: 'post',
    path: '/imports/{id}/cancel',
    summary: 'Stop an import (catalog.write)',
    request: { params: Id },
    responses: json(Job, 'Import'),
  }),
  importErrors: r({
    method: 'get',
    path: '/imports/{id}/errors',
    summary: 'Row errors in row order (the first 1,000; total counts all)',
    request: {
      params: Id,
      query: z.object({
        afterRow: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      }),
    },
    responses: json(
      z.object({
        items: z.array(
          z.object({
            row: z.number().int(),
            field: z.string(),
            code: z.string(),
            message: z.string(),
          }),
        ),
        total: z.number().int(),
      }),
      'Errors',
    ),
  }),
  importImages: r({
    method: 'get',
    path: '/imports/{id}/images',
    summary: 'The image step’s work list (pending first)',
    request: {
      params: Id,
      query: z.object({
        status: z.enum(['pending', 'done', 'failed']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    responses: json(
      z.array(
        z.object({
          id: z.uuid(),
          row: z.number().int(),
          productId: z.uuid(),
          variantId: z.uuid().nullable(),
          url: z.string(),
          position: z.number().int(),
          status: z.enum(['pending', 'done', 'failed']),
        }),
      ),
      'Images',
    ),
  }),
  completeImage: r({
    method: 'patch',
    path: '/imports/{id}/images/{imageId}',
    summary: 'Report one image: uploaded and registered, or failed (catalog.write)',
    request: {
      params: z.object({ id: z.uuid(), imageId: z.uuid() }),
      ...body(
        z.discriminatedUnion('status', [
          z.object({ status: z.literal('done'), mediaId: z.uuid() }),
          z.object({ status: z.literal('failed'), error: z.string().min(1).max(500) }),
        ]),
      ),
    },
    responses: json(Job, 'Import'),
  }),
} as const;

export function registerImports(admin: OpenAPIHono<StaffEnv>): void {
  const R = IMPORT_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.imports, async (c) =>
    c.json(await inStore(c, (tx) => listImportJobs(tx, actor(c))), 200),
  );
  admin.openapi(R.createImport, async (c) => {
    const input = c.req.valid('json');
    const key = c.req.header('idempotency-key');
    const result = await inStore<{ body: unknown }>(
      c,
      async (tx) =>
        key
          ? runIdempotent(tx, { scope: 'admin.import.create', key, request: input }, async () => ({
              status: 201,
              body: await createImportJob(tx, actor(c), input),
            }))
          : { body: await createImportJob(tx, actor(c), input) },
      write,
    );
    return c.json(result.body as never, 201);
  });
  admin.openapi(R.importJob, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => getImportJob(tx, actor(c), id)), 200);
  });
  admin.openapi(R.stageChunk, async (c) => {
    const { id, n } = c.req.valid('param');
    if (Number(c.req.header('content-length') ?? 0) > MAX_CHUNK_BYTES)
      throw new AppError('payload_too_large');
    const products = c.req.valid('json');
    const job = await inStore(c, (tx) => getImportJob(tx, actor(c), id), write);
    if (!actor(c).permissions.has('catalog.write')) throw new AppError('forbidden');
    if (job.status !== 'staging')
      throw new AppError('illegal_transition', { detail: `the import is ${job.status}` });
    if (n >= job.chunkCount) throw new AppError('not_found');
    const text = JSON.stringify(products);
    if (text.length > MAX_CHUNK_BYTES) throw new AppError('payload_too_large');
    await c.env.FILES.put(chunkKey(actor(c).tenantId as string, id, n), text, {
      httpMetadata: { contentType: 'application/json' },
    });
    return c.body(null, 204);
  });
  admin.openapi(R.startImport, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = actor(c).tenantId as string;
    const staged = await inStore(c, (tx) => getImportJob(tx, actor(c), id));
    for (let n = 0; n < staged.chunkCount; n++) {
      if (!(await c.env.FILES.head(chunkKey(tenantId, id, n)))) {
        throw new AppError('validation_failed', {
          fields: [{ path: `chunks.${n}`, code: 'missing', message: 'not staged' }],
        });
      }
    }
    const job = await inStore(c, (tx) => startImport(tx, actor(c), id), write);
    const message: ImportMessage = { tenantId, jobId: id, chunk: 0 };
    try {
      await c.env.IMPORTS.send(message, { contentType: 'json' });
    } catch (e) {
      await inStore(c, (tx) => unstartImport(tx, id));
      throw e;
    }
    return c.json(job, 200);
  });
  admin.openapi(R.cancelImport, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => cancelImport(tx, actor(c), id), write), 200);
  });
  admin.openapi(R.importErrors, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(await inStore(c, (tx) => listImportErrors(tx, actor(c), id, query)), 200);
  });
  admin.openapi(R.importImages, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(await inStore(c, (tx) => listImportImages(tx, actor(c), id, query)), 200);
  });
  admin.openapi(R.completeImage, async (c) => {
    const { id, imageId } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await inStore(c, (tx) => completeImportImage(tx, actor(c), id, imageId, input), write),
      200,
    );
  });
}
