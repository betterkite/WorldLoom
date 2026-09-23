import { NextResponse, type NextRequest } from 'next/server';
import { LINT_QUALITY_BOUNDARY, listLintFindings, runLint } from '@/lib/governance/lint';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

/** Findings at the master version (default: non-fixed). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const statusParam = new URL(request.url).searchParams.get('status');
    const status =
      statusParam === 'open' || statusParam === 'ignored' || statusParam === 'fixed'
        ? statusParam
        : null;
    return NextResponse.json({
      findings: await listLintFindings(worldId, status),
      qualityBoundary: LINT_QUALITY_BOUNDARY
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Run all lint rules against the master version (idempotent, preserves ignored). */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json(await runLint(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}
