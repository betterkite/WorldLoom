import { searchWorld } from '@/lib/retrieval/search';
import { runLint } from '@/lib/governance/lint';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { prisma } from '@/lib/db/client';
import { createSource } from '@/lib/intake/sources';
import { createCompileRun, executeCompileRun } from '@/lib/worldbuilding/compile-run';
import { LlmError, chat } from '@/lib/llm/client';
import { EmbeddingError } from '@/lib/llm/embeddings';
import type { ChatFn } from '@/lib/worldbuilding/genesis';

/**
 * MCP server (A6-2): minimal JSON-RPC 2.0 over HTTP POST /api/mcp.
 * Tools expose the world to external agents:
 *   query_world    — hybrid retrieval over a world (no LLM required)
 *   compile_source — queue a durable two-step compile of raw text
 *   lint_world     — consistency findings summary
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function error(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Never expose provider bodies, database errors, or stack details over MCP. */
export function mcpErrorMessage(caught: unknown): string {
  if (caught instanceof LlmError) return '模型服务暂不可用，请稍后重试';
  if (caught instanceof EmbeddingError) return '语义服务暂不可用，已保留词法检索';
  if (caught instanceof GovernanceError) return `请求无法处理（${caught.code}）`;
  return '请求无法处理';
}

const TOOLS = [
  {
    name: 'query_world',
    description: '混合检索世界观设定（条目+事件），返回带摘要的命中列表',
    inputSchema: {
      type: 'object',
      properties: {
        worldId: { type: 'string' },
        query: { type: 'string' },
        topK: { type: 'number' }
      },
      required: ['worldId', 'query']
    }
  },
  {
    name: 'compile_source',
    description: '把一段素材编译为世界观条目与事件（两步 LLM 管线，产物进入审阅队列）',
    inputSchema: {
      type: 'object',
      properties: {
        worldId: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['worldId', 'content']
    }
  },
  {
    name: 'lint_world',
    description: '对世界主版本运行一致性体检，返回因果倒置/悬空引用等发现',
    inputSchema: {
      type: 'object',
      properties: { worldId: { type: 'string' } },
      required: ['worldId']
    }
  }
];

async function callTool(
  name: string,
  args: Record<string, unknown>,
  runner: ChatFn
): Promise<unknown> {
  const worldId = String(args.worldId ?? '');
  await requireWorld(worldId);
  switch (name) {
    case 'query_world': {
      const result = await searchWorld(worldId, String(args.query ?? ''), {
        topK: typeof args.topK === 'number' ? args.topK : 8
      });
      return {
        mode: result.mode,
        hits: result.hits.map((hit) => ({
          kind: hit.kind,
          uid: hit.uid,
          name: hit.name,
          summary: hit.summary
        }))
      };
    }
    case 'lint_world': {
      const result = await runLint(worldId);
      return {
        version: result.version,
        qualityBoundary: result.qualityBoundary,
        counts: result.counts,
        findings: result.findings
          .filter((finding) => finding.status === 'open')
          .map((finding) => ({
            rule: finding.rule,
            severity: finding.severity,
            message: finding.message
          }))
      };
    }
    case 'compile_source': {
      const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
      const content = String(args.content ?? '');
      if (!content.trim()) throw new Error('content is required');
      const source = await createSource(worldId, {
        filename: String(args.filename ?? 'mcp-source.md'),
        content,
        author: 'mcp'
      });
      const [epochs, entities, events] = await Promise.all([
        prisma.epoch.findMany({
          where: { worldId, version: world.masterVersion },
          select: { uid: true, name: true }
        }),
        prisma.entity.findMany({
          where: { worldId, version: world.masterVersion },
          select: { uid: true, name: true, kind: true }
        }),
        prisma.chronicleEvent.findMany({
          where: { worldId, version: world.masterVersion },
          select: { uid: true, title: true }
        })
      ]);
      const created = await createCompileRun(worldId, {
        kind: 'source',
        sourceId: source.source.id,
        sourceFilename: source.source.filename,
        sourceContent: source.source.content,
        context: {
          worldName: world.name,
          premise: world.premise,
          style: world.style,
          catalog: {
            epochs: epochs.map((e) => ({ uid: e.uid, name: e.name })),
            entities: entities.map((e) => ({ uid: e.uid, name: e.name, kind: e.kind })),
            events: events.map((e) => ({ uid: e.uid, title: e.title }))
          },
          sourceFilename: source.source.filename
        }
      });
      void executeCompileRun(created.run.id, runner);
      return {
        runId: created.run.id,
        status: created.run.status,
        totalChunks: created.run.totalChunks,
        reused: created.reused
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleMcpRequest(request: JsonRpcRequest, runner: ChatFn = chat) {
  try {
    if (request.method === 'initialize') {
      return result(request.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'worldloom', version: '0.1.0' }
      });
    }
    if (request.method === 'tools/list') {
      return result(request.id, { tools: TOOLS });
    }
    if (request.method === 'tools/call') {
      const name = String(request.params?.name ?? '');
      const args = (request.params?.arguments as Record<string, unknown>) ?? {};
      const output = await callTool(name, args, runner);
      return result(request.id, {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
      });
    }
    return error(request.id, -32601, `Method not found: ${request.method}`);
  } catch (caught) {
    return error(request.id, -32000, mcpErrorMessage(caught));
  }
}
