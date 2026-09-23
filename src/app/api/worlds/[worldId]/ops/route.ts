import { NextResponse } from 'next/server';
import { getRunHealth, DATA_CONTRACTS, getContractStats } from '@/lib/ops/runhealth';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { worldId } = await params;
    const health = await getRunHealth(worldId);
    const compilerStats = await getContractStats(worldId);
    return NextResponse.json({ ...health, contracts: DATA_CONTRACTS, compilerStats });
  } catch (error) {
    return errorResponse(error);
  }
}
