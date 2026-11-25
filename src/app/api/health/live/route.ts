import { NextResponse } from 'next/server';
import { WORLDLOOM_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

/** Process liveness only. Never reach the database or an external provider. */
export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'worldloom',
      version: WORLDLOOM_VERSION,
      timestamp: new Date().toISOString()
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
