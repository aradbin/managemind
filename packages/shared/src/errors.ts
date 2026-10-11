// Typed application errors and RFC 9457 problem details. Codes are stable
// API contract: clients branch on `code`, never on `title` or `detail`.

export const ERROR_CODES = {
  validation_failed: { status: 422, title: 'Validation failed' },
  unauthorized: { status: 401, title: 'Unauthorized' },
  forbidden: { status: 403, title: 'Forbidden' },
  two_factor_required: { status: 403, title: 'Two-factor verification required' },
  role_not_allowed: { status: 403, title: 'Role not allowed' },
  not_found: { status: 404, title: 'Not found' },
  store_not_found: { status: 404, title: 'Store not found' },
  conflict: { status: 409, title: 'Conflict' },
  slug_taken: { status: 409, title: 'Store address already taken' },
  last_owner: { status: 409, title: 'A store needs at least one owner' },
  illegal_transition: { status: 409, title: 'Illegal state transition' },
  idempotency_key_reused: { status: 422, title: 'Idempotency key reused with a different request' },
  idempotency_request_in_progress: {
    status: 409,
    title: 'A request with this idempotency key is in progress',
  },
  invitation_invalid: { status: 410, title: 'Invitation no longer valid' },
  slug_reserved: { status: 422, title: 'Store address reserved' },
  tenant_suspended: { status: 423, title: 'Store suspended' },
  rate_limited: { status: 429, title: 'Too many requests' },
  tenant_context_missing: { status: 500, title: 'Internal error' },
  internal: { status: 500, title: 'Internal error' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface FieldError {
  /** JSON path of the field, e.g. "items.0.quantity". */
  path: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly fields: readonly FieldError[] | undefined;

  constructor(
    code: ErrorCode,
    options: { detail?: string; fields?: readonly FieldError[]; cause?: unknown } = {},
  ) {
    super(options.detail ?? ERROR_CODES[code].title, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.detail = options.detail;
    this.fields = options.fields;
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  /** The request ID, so a report can be matched to logs. */
  instance?: string;
  errors?: readonly FieldError[];
}

/**
 * Converts any thrown value to problem details. Unknown errors and all 5xx
 * become `internal` with no detail, so messages, stacks and SQL never leak.
 */
export function toProblem(
  error: unknown,
  context: { errorBaseUrl: string; requestId?: string },
): ProblemDetails {
  const known = error instanceof AppError && error.status < 500 ? error : undefined;
  const code: ErrorCode = known?.code ?? 'internal';
  const { status, title } = ERROR_CODES[code];
  const problem: ProblemDetails = {
    type: `${context.errorBaseUrl.replace(/\/$/, '')}/${code}`,
    title,
    status,
    code,
  };
  if (known?.detail) problem.detail = known.detail;
  if (known?.fields?.length) problem.errors = known.fields;
  if (context.requestId) problem.instance = context.requestId;
  return problem;
}
