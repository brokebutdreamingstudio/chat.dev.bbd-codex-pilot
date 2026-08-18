import { NextResponse } from 'next/server';
import { verifyBearer } from './security';
import type { ControlConfig } from './types';

export type HttpErrorCode = 'unauthorized' | 'invalid_request' | 'not_found' | 'payload_too_large' | 'dispatch_failed';

export function jsonError(status: number, code: HttpErrorCode): NextResponse<{ error: HttpErrorCode }> {
  return NextResponse.json({ error: code }, { status });
}

export function requireControlBearer(request: Request, config: ControlConfig): boolean {
  return verifyBearer(request.headers.get('authorization'), config.controlToken);
}

export function requireIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('idempotency-key');
  return key && key.trim().length > 0 ? key : null;
}
