// Expenses in the admin (phase-8-plan §3.6, §3.12): the API's shapes, the
// queries, the month arithmetic and the receipt photo's upload.
import type { paths } from '@managemind/sdk';
import { RECEIPT_PHOTO_MAX_BYTES } from '@managemind/shared/back-office';
import { api, unwrap } from './api';
import { prepareImage } from './images';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type ExpenseCategory = Json<'/v1/admin/expense-categories', 'get'>[number];
export type ExpensePage = Json<'/v1/admin/expenses', 'get'>;
export type Expense = ExpensePage['items'][number];
export type RecurringExpense = Json<'/v1/admin/recurring-expenses', 'get'>[number];

export const expenseCategoriesQuery = {
  queryKey: ['expense-categories'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/expense-categories')),
  staleTime: 60_000,
};

export const recurringExpensesQuery = {
  queryKey: ['recurring-expenses'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/recurring-expenses')),
};

export const EXPENSE_KEYS = [['expenses'], ['expense-categories'], ['recurring-expenses']] as const;

/** A month as YYYY-MM, its first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** This month in Dhaka. */
export const thisMonth = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 7);

/**
 * Shrinks a receipt photo in the browser (its EXIF, GPS included, dropped)
 * to a width that keeps the print legible, under 2 MB (Q8), then uploads it.
 */
export async function uploadReceipt(expenseId: string, file: File): Promise<void> {
  const image = await prepareImage(file, [1600]);
  const blob = image.files[image.files.length - 1]?.blob;
  if (!blob || blob.size > RECEIPT_PHOTO_MAX_BYTES) throw new Error('too_large');
  const res = await fetch(`/api/admin/expenses/${expenseId}/receipt`, {
    method: 'POST',
    body: blob,
    headers: { 'content-type': image.mime },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
}
