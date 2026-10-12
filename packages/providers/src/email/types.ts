// The email provider interface (PLAN.md, pluggable providers; ADR 0015).

export interface EmailMessage {
  /** One recipient. Messages are never sent to several people at once. */
  to: string;
  /** "Name <address>". */
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** For filtering in the provider's dashboard: lowercase letters, digits, '_' and '-'. */
  tags?: Record<string, string>;
  /** The same key on every attempt, so a retry never sends twice. */
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

/**
 * A failed send. `code` is stable; the message never contains the recipient
 * or the body, so the error can be logged and reported as is.
 */
export class EmailError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(code: string, options: { retryable: boolean; status?: number; message?: string }) {
    super(options.message ?? code);
    this.name = 'EmailError';
    this.code = code;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}
