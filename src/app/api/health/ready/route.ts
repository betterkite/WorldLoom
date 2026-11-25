import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { WORLDLOOM_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

/** Readiness is limited to the required PostgreSQL dependency. */
export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: 'ready',
        service: 'worldloom',
        version: WORLDLOOM_VERSION,
        checks: { database: 'ok' },
        timestamp
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      {
        status: 'not_ready',
        service: 'worldloom',
        version: WORLDLOOM_VERSION,
        checks: { database: 'unavailable' },
        timestamp
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}
