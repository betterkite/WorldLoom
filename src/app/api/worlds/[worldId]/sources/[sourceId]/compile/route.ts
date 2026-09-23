import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireWorld } from '@/lib/governance/changes';
import { createCompileRun, executeCompileRun } from '@/lib/worldbuilding/compile-run';
import { listEpochs, listEntities, listEvents } from '@/lib/worldbuilding/content';
import { errorResponse } from '@/lib/api';
import { chat } from '@/lib/llm/client';

type Params = { params: Promise<{ worldId: string; sourceId: string }> };

/**
 * Queue a raw source for world compilation.
 * The run/checkpoint is durable; nothing touches the canon until completion + merge.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, sourceId } = await params;
    const world = await requireWorld(worldId);

    const source = await prisma.source.findFirst({ where: { id: sourceId, worldId } });
    if (!source) {
      return NextResponse.json(
        { error: { code: 'source_not_found', message: 'Source not found' } },
        { status: 404 }
      );
    }

    const [epochs, entities, events] = await Promise.all([
      listEpochs(worldId),
      listEntities(worldId),
      listEvents(worldId)
    ]);

    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceId: source.id,
      sourceFilename: source.filename,
      sourceContent: source.content,
      context: {
        worldName: world.name,
        premise: world.premise,
        style: world.style,
        catalog: {
          epochs: epochs.map((e) => ({ uid: e.uid, name: e.name })),
          entities: entities.map((e) => ({ uid: e.uid, name: e.name, kind: e.kind })),
          events: events.map((e) => ({ uid: e.uid, title: e.title }))
        },
        sourceFilename: source.filename
      }
    });

    // The local Next process owns the runner; all progress and outputs are
    // checkpointed first, so a later resume can continue after a restart.
    void executeCompileRun(created.run.id, chat);
    return NextResponse.json(
      {
        runId: created.run.id,
        status: created.run.status,
        totalChunks: created.run.totalChunks,
        reused: created.reused
      },
      { status: 202 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
