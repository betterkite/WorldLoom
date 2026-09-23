import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import type { ChatFn } from '@/lib/worldbuilding/genesis';
import { handleMcpRequest, mcpErrorMessage } from '@/lib/mcp/server';
import { LlmError } from '@/lib/llm/client';
import { LlmUsageBudgetError } from '@/lib/llm/usage-budget';

const ANALYSIS = JSON.stringify({
  world_facts: ['MCP 测试事实'],
  contradictions: [],
  entity_threads: [],
  event_threads: [],
  open_questions: []
});

const GENERATED = JSON.stringify({
  epochs: [],
  entities: [
    {
      kind: 'character',
      name: 'MCP 角色',
      aliases: [],
      summary: '测试角色',
      content: '测试内容',
      confidence: 'EXTRACTED',
      tags: []
    }
  ],
  events: [],
  relations: []
});

async function cleanDb() {
  await prisma.$transaction([
    prisma.compileChunk.deleteMany(),
    prisma.compileRun.deleteMany(),
    prisma.tombstone.deleteMany(),
    prisma.conflictRecord.deleteMany(),
    prisma.worldVersion.deleteMany(),
    prisma.change.deleteMany(),
    prisma.eventEdge.deleteMany(),
    prisma.relationshipEvent.deleteMany(),
    prisma.chronicleEvent.deleteMany(),
    prisma.entity.deleteMany(),
    prisma.epoch.deleteMany(),
    prisma.source.deleteMany(),
    prisma.world.deleteMany()
  ]);
}

function scriptedChat(): ChatFn {
  let calls = 0;
  return async () => {
    calls += 1;
    return {
      content: calls % 2 === 1 ? ANALYSIS : GENERATED,
      profileId: 'fake',
      model: 'fake',
      usage: null,
      latencyMs: 1
    };
  };
}

async function waitForCompletion(runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await prisma.compileRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'completed' || run.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('MCP compile run did not finish in time');
}

describe('MCP durable compiler entrypoint', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('queues compile_source through CompileRun and persists staged changes', async () => {
    const world = await createWorld({ name: 'MCP 世界', premise: 'MCP 测试' });
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'compile_source',
          arguments: { worldId: world.id, content: 'MCP 素材内容' }
        }
      },
      scriptedChat()
    );

    expect(response).toHaveProperty('result');
    if (!('result' in response)) throw new Error('MCP request failed');
    const result = response.result as { content: Array<{ text: string }> };
    const output = JSON.parse(result.content[0].text) as {
      runId: string;
      status: string;
      totalChunks: number;
    };
    expect(output.status).toBe('queued');
    expect(output.totalChunks).toBe(1);

    const run = await waitForCompletion(output.runId);
    expect(run.status).toBe('completed');
    expect(await prisma.change.count({ where: { worldId: world.id } })).toBeGreaterThan(0);
  });

  it('does not expose provider bodies or internal details over JSON-RPC', () => {
    const providerError = new LlmError(
      'llm_upstream_error',
      'deepseek-official',
      'Profile returned HTTP 401: provider account secret',
      { status: 401 }
    );
    const message = mcpErrorMessage(providerError);
    expect(message).toBe('模型服务暂不可用，请稍后重试');
    expect(message).not.toContain('provider account secret');
    expect(
      mcpErrorMessage(
        new LlmUsageBudgetError(
          'answer evaluation',
          'deepseek-official',
          'private accounting detail'
        )
      )
    ).toBe('本次模型操作超出已配置预算');
    expect(mcpErrorMessage(new Error('database password'))).toBe('请求无法处理');
  });
});
