export type DomainErrorKind = 'not_found' | 'conflict' | 'invalid' | 'upstream';

/**
 * Base error for application and domain layers. Keeps those layers free of HTTP concerns;
 * AllExceptionsFilter maps `kind` to an HTTP status.
 */
export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super('not_found', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message);
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string) {
    super('invalid', message);
  }
}

export class UpstreamError extends DomainError {
  constructor(message: string, cause?: unknown) {
    super('upstream', message, { cause });
  }
}
