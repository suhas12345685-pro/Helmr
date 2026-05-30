export type SharedErrorKind = 'validation' | 'policy_denial' | 'lock_conflict' | 'tool_failure';

export interface SharedErrorOptions {
  cause?: unknown;
}

export class SharedError extends Error {
  public readonly kind: SharedErrorKind;
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    name: string,
    message: string,
    kind: SharedErrorKind,
    code: string,
    status: number,
    details?: unknown,
    options?: SharedErrorOptions,
  ) {
    super(message, options);
    this.name = name;
    this.kind = kind;
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      code: this.code,
      status: this.status,
      details: this.details,
    };
  }
}

export function validationError(message: string, details?: unknown): SharedError {
  return new SharedError('ValidationError', message, 'validation', 'VALIDATION_ERROR', 400, details);
}

export function policyDenialError(message: string, details?: unknown): SharedError {
  return new SharedError('PolicyDenialError', message, 'policy_denial', 'POLICY_DENIED', 403, details);
}

export function lockConflictError(message: string, details?: unknown): SharedError {
  return new SharedError('LockConflictError', message, 'lock_conflict', 'LOCK_CONFLICT', 409, details);
}

export function toolFailureError(
  message: string,
  details?: unknown,
  options?: SharedErrorOptions,
): SharedError {
  return new SharedError('ToolFailureError', message, 'tool_failure', 'TOOL_FAILURE', 502, details, options);
}

export function isSharedError(error: unknown): error is SharedError {
  return error instanceof SharedError;
}
