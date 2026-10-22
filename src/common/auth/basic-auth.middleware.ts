import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Paths reachable without credentials (monitoring). Matched against the full URL path. */
const PUBLIC_PATHS = new Set(['/api/health']);

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time comparison; hashing first makes the lengths equal. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Parses `Authorization: Basic base64(user:pass)`; null when missing or malformed. */
export function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

/**
 * Single-user HTTP Basic Auth for the whole HTTP app (API and Swagger). The browser shows its own
 * login prompt on the 401 and then sends the credentials with every request.
 */
export function basicAuth(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    const given = parseBasicAuth(req.headers.authorization);
    // Both comparisons always run, so timing does not reveal which part was wrong.
    const userOk = safeEqual(given?.user ?? '', username);
    const passOk = safeEqual(given?.pass ?? '', password);
    if (given && userOk && passOk) return next();

    res.status(401).setHeader('WWW-Authenticate', 'Basic realm="backtrail", charset="UTF-8"').json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  };
}
