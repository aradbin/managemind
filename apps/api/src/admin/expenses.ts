// Expenses in the admin (phase-8-plan §3.6, §6): categories, entries with a
// receipt photo, and recurring entries. Photos go through the Worker to the
// store's private R2 prefix, as return photos do (ADR 0016): at most 2 MB,
// JPEG, PNG or WebP, never cached by anything shared.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createExpense,
  createExpenseCategory,
  createRecurringExpense,
  deleteExpense,
  deleteRecurringExpense,
  expenseReceipt,
  getExpense,
  importExpenses,
  listExpenseCategories,
  listExpenses,
  listRecurringExpenses,
  setExpenseReceipt,
  updateExpense,
  updateExpenseCategory,
  updateRecurringExpense,
} from '@managemind/core';
import { AppError, objectKey, uuidv7 } from '@managemind/shared';
import {
  BACK_OFFICE_IMPORT_LIMITS,
  EXPENSE_CADENCES,
  expenseCategoryInput,
  expenseCategoryPatch,
  expenseInput,
  expensePatch,
  importExpense,
  RECEIPT_PHOTO_MAX_BYTES,
  recurringExpenseInput,
  recurringExpensePatch,
  SPEND_METHODS,
} from '@managemind/shared/back-office';
import { MEDIA_EXTENSIONS, sniffImageType } from '@managemind/shared/catalog';
import { inStore, type StaffEnv } from './context';
import { idempotent } from './orders';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string, status = 200) => ({
  [status]: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const Id = z.object({ id: z.uuid() });
const IdemHeader = z.object({ 'idempotency-key': z.string().min(8).max(255).optional() });
const Money = z.number().int();
const binary = z.string().openapi({ format: 'binary' });

const Category = z
  .object({
    id: z.uuid(),
    key: z.string().nullable(),
    name: z.object({ bn: z.string(), en: z.string() }),
    position: z.number().int(),
    archived: z.boolean(),
  })
  .openapi('ExpenseCategory');
const Expense = z
  .object({
    id: z.uuid(),
    spentOn: z.string(),
    categoryId: z.uuid(),
    amount: Money,
    method: z.enum(SPEND_METHODS),
    payee: z.string().nullable(),
    note: z.string().nullable(),
    hasReceipt: z.boolean(),
    recurringExpenseId: z.uuid().nullable(),
    recordedBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Expense');
const ExpensePage = z
  .object({
    items: z.array(Expense),
    nextCursor: z.string().nullable(),
    totals: z.object({
      total: Money,
      count: z.number().int(),
      byCategory: z.array(z.object({ categoryId: z.uuid(), amount: Money })),
    }),
  })
  .openapi('ExpensePage');
const Recurring = z
  .object({
    id: z.uuid(),
    categoryId: z.uuid(),
    amount: Money,
    method: z.enum(SPEND_METHODS),
    payee: z.string().nullable(),
    note: z.string().nullable(),
    cadence: z.enum(EXPENSE_CADENCES),
    day: z.number().int(),
    startsOn: z.string(),
    endsOn: z.string().nullable(),
    nextOn: z.string().nullable(),
    active: z.boolean(),
  })
  .openapi('RecurringExpense');

const MIME_BY_EXT = Object.fromEntries(
  Object.entries(MEDIA_EXTENSIONS).map(([mime, ext]) => [ext, mime]),
) as Record<string, string>;

export const EXPENSE_ROUTES = {
  expenseCategories: r({
    method: 'get',
    path: '/expense-categories',
    summary: "The store's expense categories, seeded the first time (expenses.read)",
    responses: json(z.array(Category), 'Categories'),
  }),
  createExpenseCategory: r({
    method: 'post',
    path: '/expense-categories',
    summary: 'A new category (expenses.write)',
    request: body(expenseCategoryInput),
    responses: json(Category, 'Created', 201),
  }),
  updateExpenseCategory: r({
    method: 'patch',
    path: '/expense-categories/{id}',
    summary: 'Rename, reorder or archive a category (expenses.write)',
    request: { params: Id, ...body(expenseCategoryPatch) },
    responses: json(Category, 'Updated'),
  }),
  expenses: r({
    method: 'get',
    path: '/expenses',
    summary: 'Expenses, newest first, with the range’s totals per category (expenses.read)',
    request: {
      query: z.object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        categoryId: z.uuid().optional(),
        before: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    responses: json(ExpensePage, 'Expenses'),
  }),
  createExpense: r({
    method: 'post',
    path: '/expenses',
    summary: 'Record an expense (expenses.write)',
    request: { headers: IdemHeader, ...body(expenseInput) },
    responses: json(Expense, 'Recorded', 201),
  }),
  importExpenses: r({
    method: 'post',
    path: '/expenses/import',
    summary:
      'Past expenses from a file the browser read, up to 200 a request; one identical to a recorded expense is skipped (expenses.write)',
    request: {
      headers: IdemHeader,
      ...body(z.array(importExpense).min(1).max(BACK_OFFICE_IMPORT_LIMITS.chunk)),
    },
    responses: json(
      z.object({
        created: z.number().int(),
        skipped: z.array(z.object({ row: z.number().int(), reason: z.enum(['exists']) })),
      }),
      'Imported',
    ),
  }),
  updateExpense: r({
    method: 'patch',
    path: '/expenses/{id}',
    summary: 'Correct an expense; audited (expenses.write)',
    request: { params: Id, ...body(expensePatch) },
    responses: json(Expense, 'Updated'),
  }),
  deleteExpense: r({
    method: 'delete',
    path: '/expenses/{id}',
    summary: 'Delete an expense and its receipt photo; audited (expenses.write)',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
  uploadReceipt: r({
    method: 'post',
    path: '/expenses/{id}/receipt',
    summary: "The expense's receipt photo, replacing any (expenses.write; at most 2 MB)",
    request: {
      params: Id,
      body: {
        content: {
          'image/webp': { schema: binary },
          'image/jpeg': { schema: binary },
          'image/png': { schema: binary },
        },
        required: true,
      },
    },
    responses: json(Expense, 'Stored'),
  }),
  receipt: r({
    method: 'get',
    path: '/expenses/{id}/receipt',
    summary: "The expense's receipt photo (expenses.read)",
    request: { params: Id },
    responses: { 200: { content: { 'image/*': { schema: binary } }, description: 'The photo' } },
  }),
  deleteReceipt: r({
    method: 'delete',
    path: '/expenses/{id}/receipt',
    summary: "Remove the expense's receipt photo (expenses.write)",
    request: { params: Id },
    responses: { 204: { description: 'Removed' } },
  }),
  recurringExpenses: r({
    method: 'get',
    path: '/recurring-expenses',
    summary: 'Recurring entries, active first (expenses.read)',
    responses: json(z.array(Recurring), 'Recurring entries'),
  }),
  createRecurringExpense: r({
    method: 'post',
    path: '/recurring-expenses',
    summary: 'A recurring entry; it posts from today on (expenses.write)',
    request: body(recurringExpenseInput),
    responses: json(Recurring, 'Created', 201),
  }),
  updateRecurringExpense: r({
    method: 'patch',
    path: '/recurring-expenses/{id}',
    summary: 'Change a recurring entry; only future posts change (expenses.write)',
    request: { params: Id, ...body(recurringExpensePatch) },
    responses: json(Recurring, 'Updated'),
  }),
  deleteRecurringExpense: r({
    method: 'delete',
    path: '/recurring-expenses/{id}',
    summary: 'Delete a recurring entry; what it posted stays (expenses.write)',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
} as const;

export function registerExpenses(admin: OpenAPIHono<StaffEnv>): void {
  const R = EXPENSE_ROUTES;
  const actor = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.expenseCategories, async (c) =>
    c.json(await inStore(c, (tx) => listExpenseCategories(tx, actor(c))), 200),
  );
  admin.openapi(R.createExpenseCategory, async (c) =>
    c.json(
      await inStore(c, (tx) => createExpenseCategory(tx, actor(c), c.req.valid('json')), write),
      201,
    ),
  );
  admin.openapi(R.updateExpenseCategory, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updateExpenseCategory(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.expenses, async (c) =>
    c.json(await inStore(c, (tx) => listExpenses(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.importExpenses, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) => idempotent(c, tx, 'expense_import', input, () => importExpenses(tx, actor(c), input)),
      write,
    );
    return c.json(result.body as never, 200);
  });
  admin.openapi(R.createExpense, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) => idempotent(c, tx, 'expense', input, () => createExpense(tx, actor(c), input), 201),
      write,
    );
    return c.json(result.body as never, 201);
  });
  admin.openapi(R.updateExpense, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updateExpense(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.deleteExpense, async (c) => {
    const { receiptKey } = await inStore(
      c,
      (tx) => deleteExpense(tx, actor(c), c.req.valid('param').id),
      write,
    );
    // A failed delete only orphans a file no row points at.
    if (receiptKey) await c.env.FILES.delete(receiptKey).catch(() => {});
    return c.body(null, 204);
  });

  admin.openapi(R.uploadReceipt, async (c) => {
    const { id } = c.req.valid('param');
    if (Number(c.req.header('content-length') ?? 0) > RECEIPT_PHOTO_MAX_BYTES) {
      throw new AppError('payload_too_large');
    }
    // The expense must be the store's, and the actor allowed to change it, before any upload.
    await inStore(
      c,
      async (tx) => {
        if (!actor(c).permissions.has('expenses.write')) throw new AppError('forbidden');
        await getExpense(tx, actor(c), id);
      },
      write,
    );
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new AppError('validation_failed');
    if (bytes.byteLength > RECEIPT_PHOTO_MAX_BYTES) throw new AppError('payload_too_large');
    const type = sniffImageType(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16)));
    if (!type) throw new AppError('unsupported_media_type');
    const ext = MEDIA_EXTENSIONS[type];
    const key = objectKey('file', actor(c).tenantId as string, `expenses/${id}-${uuidv7()}.${ext}`);
    await c.env.FILES.put(key, bytes, {
      httpMetadata: { contentType: MIME_BY_EXT[ext] ?? type, cacheControl: 'private, no-store' },
    });
    const { replacedKey, expense } = await inStore(
      c,
      (tx) => setExpenseReceipt(tx, actor(c), id, { key, mimeType: type, bytes: bytes.byteLength }),
      write,
    );
    if (replacedKey) await c.env.FILES.delete(replacedKey).catch(() => {});
    return c.json(expense, 200);
  });
  admin.openapi(R.receipt, async (c) => {
    const media = await inStore(c, (tx) => expenseReceipt(tx, actor(c), c.req.valid('param').id));
    const object = await c.env.FILES.get(media.key);
    if (!object) throw new AppError('not_found');
    return new Response(object.body, {
      headers: {
        'content-type': media.mimeType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });
  admin.openapi(R.deleteReceipt, async (c) => {
    const { replacedKey } = await inStore(
      c,
      (tx) => setExpenseReceipt(tx, actor(c), c.req.valid('param').id, null),
      write,
    );
    if (replacedKey) await c.env.FILES.delete(replacedKey).catch(() => {});
    return c.body(null, 204);
  });

  admin.openapi(R.recurringExpenses, async (c) =>
    c.json(await inStore(c, (tx) => listRecurringExpenses(tx, actor(c))), 200),
  );
  admin.openapi(R.createRecurringExpense, async (c) =>
    c.json(
      await inStore(c, (tx) => createRecurringExpense(tx, actor(c), c.req.valid('json')), write),
      201,
    ),
  );
  admin.openapi(R.updateRecurringExpense, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updateRecurringExpense(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.deleteRecurringExpense, async (c) => {
    await inStore(c, (tx) => deleteRecurringExpense(tx, actor(c), c.req.valid('param').id), write);
    return c.body(null, 204);
  });
}
