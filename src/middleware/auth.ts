import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin';
import type { BioSwarmDatabase } from '../server/db';

export interface AuthenticatedOperator {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  operator?: AuthenticatedOperator;
}

export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 20 ? token : null;
}

export async function verifyOperatorToken(token: string): Promise<AuthenticatedOperator> {
  const decoded = await adminAuth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email ?? 'operator@biosolarswarm.local',
    emailVerified: Boolean(decoded.email_verified),
    name: decoded.name ?? decoded.email ?? decoded.uid,
  };
}

export function createRequireAuth(db: BioSwarmDatabase) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    if (!token) {
      db.appendSecurityAudit({
        actor_uid: 'unauthenticated',
        actor_email: 'anonymous',
        action: 'API_ACCESS_BLOCKED',
        target: `${req.method} ${req.path}`,
        status: 'denied',
        ip_addr: clientIp,
        detail: 'Missing or malformed Bearer Firebase ID token',
      });
      return res.status(401).json({
        error: 'Authentication required. Please sign in with Google or Email/Password credentials.',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      const operator = await verifyOperatorToken(token);
      req.operator = operator;
      return next();
    } catch (err) {
      db.appendSecurityAudit({
        actor_uid: 'unverified',
        actor_email: 'anonymous',
        action: 'TOKEN_VERIFICATION_FAILED',
        target: `${req.method} ${req.path}`,
        status: 'denied',
        ip_addr: clientIp,
        detail: err instanceof Error ? err.message : 'Invalid or expired Firebase ID token',
      });
      return res.status(401).json({
        error: 'Invalid or expired authentication token.',
        code: 'INVALID_TOKEN',
      });
    }
  };
}
