import { NextResponse } from 'next/server';

export function GET(): NextResponse<{ status: 'ok' }> {
  return NextResponse.json({ status: 'ok' });
}
