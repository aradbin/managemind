// The back office's imports (phase-8-plan §3.10): suppliers with what the
// store owed them, and past months' expenses, from CSV or Excel, read in the
// browser as the customer import is. Headers are recognized in English and
// Bangla; each row comes back with its errors (it is left out) and its
// warnings (it goes in, as the warning says).
import { z } from 'zod';
import { toLatinDigits } from '../digits';
import { parseAmount } from '../money';
import { normalizePhone } from '../phone';
import { expenseInput } from './expenses';
import { BACK_OFFICE_LIMITS } from './limits';
import { SPEND_METHODS, type SpendMethod, supplierInput } from './purchasing';

export const BACK_OFFICE_IMPORT_LIMITS = { rows: 5_000, chunk: 200 } as const;

export interface RowIssue {
  field: string;
  code: string;
  message: string;
}

const lower = (headers: readonly string[]) =>
  headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));

function mapHeaders<F extends string>(
  aliases: Record<F, readonly string[]>,
  headers: readonly string[],
): Partial<Record<F, number>> {
  const cells = lower(headers);
  const out: Partial<Record<F, number>> = {};
  for (const [field, names] of Object.entries(aliases) as [F, readonly string[]][]) {
    const i = cells.findIndex((h) => names.includes(h));
    if (i >= 0) out[field] = i;
  }
  return out;
}

const reader =
  <F extends string>(cells: readonly unknown[], columns: Partial<Record<F, number>>) =>
  (f: F) => {
    const i = columns[f];
    const v = i === undefined ? undefined : cells[i];
    return v === undefined || v === null ? '' : String(v).trim();
  };

// ---- Suppliers ---------------------------------------------------------------------------

const SUPPLIER_HEADERS = {
  name: ['name', 'supplier', 'supplier name', 'company', 'vendor', 'নাম', 'সরবরাহকারী'],
  contactName: ['contact', 'contact name', 'contact person', 'যোগাযোগ', 'যোগাযোগের ব্যক্তি'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'ফোন', 'মোবাইল'],
  phone2: ['phone 2', 'second phone', 'other phone', 'alternate phone', 'ফোন ২'],
  email: ['email', 'e-mail', 'email address', 'ইমেইল'],
  address: ['address', 'ঠিকানা'],
  city: ['city', 'district', 'area', 'শহর', 'জেলা', 'এলাকা'],
  note: ['note', 'notes', 'comment', 'নোট'],
  openingBalance: [
    'opening balance',
    'balance',
    'due',
    'owed',
    'payable',
    'opening due',
    'শুরুর বাকি',
    'বাকি',
    'পাওনা',
  ],
} as const;
export type SupplierImportField = keyof typeof SUPPLIER_HEADERS;

export const mapSupplierHeaders = (headers: readonly string[]) =>
  mapHeaders(SUPPLIER_HEADERS, headers);

export const importSupplier = supplierInput.extend({ row: z.int().min(1) }).strict();
export type ImportSupplier = z.infer<typeof importSupplier>;

/** One row as a supplier: a name is required; a phone that isn't a mobile number is left out. */
export function parseSupplierRow(
  cells: readonly unknown[],
  columns: Partial<Record<SupplierImportField, number>>,
  row: number,
): { supplier: ImportSupplier | null; errors: RowIssue[]; warnings: RowIssue[] } {
  const cell = reader(cells, columns);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const name = cell('name').slice(0, 200);
  if (!name) errors.push({ field: 'name', code: 'required', message: 'a name is required' });
  const phones: string[] = [];
  for (const f of ['phone', 'phone2'] as const) {
    for (const raw of cell(f)
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const phone = normalizePhone(raw);
      if (phone) phones.push(phone);
      else
        warnings.push({
          field: f,
          code: 'invalid',
          message: `${raw} is not a mobile number; left out`,
        });
    }
  }
  const rawEmail = cell('email').toLowerCase();
  const email = rawEmail && z.email().safeParse(rawEmail).success ? rawEmail : null;
  if (rawEmail && !email)
    warnings.push({ field: 'email', code: 'invalid', message: 'not an email address; left out' });
  const line1 = cell('address').slice(0, 200);
  const city = cell('city').slice(0, 100);
  let openingBalance = 0;
  const rawBalance = cell('openingBalance');
  if (rawBalance) {
    const amount = parseAmount(rawBalance);
    if (amount === null || Math.abs(amount) > BACK_OFFICE_LIMITS.maxAmount) {
      errors.push({ field: 'openingBalance', code: 'invalid', message: 'not an amount in taka' });
    } else openingBalance = amount;
  }
  if (errors.length) return { supplier: null, errors, warnings };
  const parsed = importSupplier.safeParse({
    row,
    name,
    ...(cell('contactName') ? { contactName: cell('contactName').slice(0, 200) } : {}),
    phones: [...new Set(phones)].slice(0, BACK_OFFICE_LIMITS.phonesPerSupplier),
    email,
    address: line1 ? { line1, ...(city ? { city } : {}) } : null,
    ...(cell('note') ? { note: cell('note').slice(0, 1000) } : {}),
    openingBalance,
  });
  if (!parsed.success) {
    return {
      supplier: null,
      errors: parsed.error.issues.map((i) => ({
        field: String(i.path[0] ?? 'row'),
        code: 'invalid',
        message: i.message,
      })),
      warnings,
    };
  }
  return { supplier: parsed.data, errors, warnings };
}

// ---- Expenses ----------------------------------------------------------------------------

const EXPENSE_HEADERS = {
  date: ['date', 'spent on', 'day', 'paid on', 'তারিখ'],
  category: ['category', 'type', 'head', 'expense head', 'ক্যাটাগরি', 'খাত', 'ধরন'],
  amount: ['amount', 'total', 'cost', 'taka', 'টাকা', 'পরিমাণ', 'খরচ'],
  method: ['method', 'paid by', 'payment method', 'payment', 'mode', 'মাধ্যম', 'পরিশোধের মাধ্যম'],
  payee: ['payee', 'paid to', 'vendor', 'to', 'প্রাপক', 'কাকে'],
  note: ['note', 'notes', 'description', 'details', 'নোট', 'বিবরণ'],
} as const;
export type ExpenseImportField = keyof typeof EXPENSE_HEADERS;

export const mapExpenseHeaders = (headers: readonly string[]) =>
  mapHeaders(EXPENSE_HEADERS, headers);

export const importExpense = expenseInput.extend({ row: z.int().min(1) }).strict();
export type ImportExpense = z.infer<typeof importExpense>;

/** A category the import can file a row under: its key (seeded ones) and names. */
export interface ImportCategory {
  id: string;
  key: string | null;
  name: { bn: string; en: string };
  archived: boolean;
}

const fold = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const METHOD_NAMES: Record<string, SpendMethod | undefined> = {
  ...Object.fromEntries(SPEND_METHODS.map((m) => [m, m])),
  cash: 'cash',
  'হাতে নগদ': 'cash',
  ক্যাশ: 'cash',
  bank: 'bank',
  'bank transfer': 'bank',
  transfer: 'bank',
  cheque: 'bank',
  check: 'bank',
  ব্যাংক: 'bank',
  bkash: 'bkash',
  বিকাশ: 'bkash',
  nagad: 'nagad',
  card: 'card',
  'credit card': 'card',
  'debit card': 'card',
  কার্ড: 'card',
  other: 'other',
  অন্য: 'other',
  অন্যান্য: 'other',
};

/** YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (as people in Bangladesh write dates); null otherwise. */
export function parseImportDate(text: string): string | null {
  const t = toLatinDigits(text).trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * One row as an expense: a date no later than `today`, an amount above zero.
 * A category that matches none of the store's is filed under Other, and a
 * missing or unknown method is taken as cash, each with a warning.
 */
export function parseExpenseRow(
  cells: readonly unknown[],
  columns: Partial<Record<ExpenseImportField, number>>,
  row: number,
  categories: readonly ImportCategory[],
  today: string,
): { expense: ImportExpense | null; errors: RowIssue[]; warnings: RowIssue[] } {
  const cell = reader(cells, columns);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const spentOn = parseImportDate(cell('date'));
  if (!spentOn) {
    errors.push({
      field: 'date',
      code: 'invalid',
      message: 'not a date (YYYY-MM-DD or DD/MM/YYYY)',
    });
  } else if (spentOn > today) {
    errors.push({ field: 'date', code: 'future', message: 'the date is after today' });
  }
  const amount = parseAmount(cell('amount'));
  if (amount === null || amount <= 0 || amount > BACK_OFFICE_LIMITS.maxAmount) {
    errors.push({ field: 'amount', code: 'invalid', message: 'not an amount in taka above zero' });
  }
  const open = categories.filter((c) => !c.archived);
  const wanted = fold(cell('category'));
  let category = wanted
    ? open.find((c) => [c.key ?? '', c.name.bn, c.name.en].some((n) => n && fold(n) === wanted))
    : undefined;
  if (!category) {
    category = open.find((c) => c.key === 'other');
    if (!category) {
      errors.push({ field: 'category', code: 'unknown', message: 'no category matches' });
    } else {
      warnings.push({
        field: 'category',
        code: 'unmatched',
        message: wanted
          ? 'no category matches; filed under Other'
          : 'no category; filed under Other',
      });
    }
  }
  const rawMethod = cell('method').toLowerCase().replace(/\s+/g, ' ');
  const known = METHOD_NAMES[rawMethod];
  const method: SpendMethod = known ?? 'cash';
  if (!known) {
    warnings.push({
      field: 'method',
      code: rawMethod ? 'unmatched' : 'missing',
      message: rawMethod
        ? 'not a payment method we know; taken as cash'
        : 'no method; taken as cash',
    });
  }
  if (errors.length || !category || !spentOn || amount === null) {
    return { expense: null, errors, warnings };
  }
  const parsed = importExpense.safeParse({
    row,
    spentOn,
    categoryId: category.id,
    amount,
    method,
    ...(cell('payee') ? { payee: cell('payee').slice(0, 200) } : {}),
    ...(cell('note') ? { note: cell('note').slice(0, 1000) } : {}),
  });
  if (!parsed.success) {
    return {
      expense: null,
      errors: parsed.error.issues.map((i) => ({
        field: String(i.path[0] ?? 'row'),
        code: 'invalid',
        message: i.message,
      })),
      warnings,
    };
  }
  return { expense: parsed.data, errors, warnings };
}
