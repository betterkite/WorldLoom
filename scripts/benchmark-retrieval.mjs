#!/usr/bin/env node
/**
 * 固定规模检索基准（ISS-34 P2）：
 *   500 entities + 2000 chronicle events，走真实 HTTP API，验证词法检索
 *   在目标规模下的 P50/P95、命中有效性和进程内存变化。
 *
 * 用法：
 *   node scripts/benchmark-retrieval.mjs [baseUrl]
 *
 * 这是本地/受控环境的可重复基线，不等同于生产 SLO。脚本只创建并删除
 * 一个带固定前缀的临时世界，不触碰其他世界；生产部署仍需按实际硬件重跑。
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';

const BASE = process.argv[2] ?? 'http://localhost:4310';
const ENTITY_COUNT = 500;
const EVENT_COUNT = 2000;
const WARMUP_COUNT = 2;
const SAMPLE_COUNT = 12;
const MAX_P95_MS = 1500;
const MAX_RSS_DELTA_MIB = 256;
const PREFIX = 'WorldLoom-检索基准-';

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  try {
    const env = readFileSync('.env', 'utf8');
    const value = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
    if (value) process.env.DATABASE_URL = value.replace(/^['"]|['"]$/g, '');
  } catch {
    // Prisma will report the missing connection string with its normal error.
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function mib(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}

async function main() {
  ensureDatabaseUrl();
  const prisma = new PrismaClient({ log: ['error'] });
  let worldId;
  const startedAt = performance.now();
  const rssBefore = process.memoryUsage().rss;

  try {
    const world = await prisma.world.create({
      data: {
        name: `${PREFIX}${new Date().toISOString()}`,
        premise: '固定规模检索基准临时世界'
      },
      select: { id: true }
    });
    worldId = world.id;

    const entities = Array.from({ length: ENTITY_COUNT }, (_, index) => ({
      worldId,
      version: 1,
      uid: `bench_entity_${String(index).padStart(4, '0')}`,
      kind: 'concept',
      name: `基准信标-${String(index).padStart(4, '0')}`,
      summary: `规模基准实体 ${String(index).padStart(4, '0')} 的稳定摘要`,
      content: `用于检索规模测量的实体内容 ${index}，包含世界观、阵列和航线词汇。`
    }));
    const events = Array.from({ length: EVENT_COUNT }, (_, index) => ({
      worldId,
      version: 1,
      uid: `bench_event_${String(index).padStart(4, '0')}`,
      title: `基准事件-${String(index).padStart(4, '0')}`,
      summary: `规模基准事件 ${String(index).padStart(4, '0')} 的摘要`,
      content: `用于检索规模测量的事件内容 ${index}，记录阵列信标的航线变化。`,
      epochYear: index + 1,
      sortOrder: index,
      participantUids: [`bench_entity_${String(index % ENTITY_COUNT).padStart(4, '0')}`]
    }));

    await prisma.$transaction([
      prisma.entity.createMany({ data: entities }),
      prisma.chronicleEvent.createMany({ data: events })
    ]);

    const queries = ['基准信标-0499', '基准事件-1499', '阵列信标航线'];
    const request = async (query) => {
      const begin = performance.now();
      const response = await fetch(`${BASE}/api/worlds/${worldId}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, topK: 8 })
      });
      const body = await response.json();
      const elapsed = performance.now() - begin;
      if (response.status !== 200) throw new Error(`search ${response.status}: ${JSON.stringify(body)}`);
      if (!Array.isArray(body.hits) || body.hits.length === 0)
        throw new Error(`search returned no hits for ${query}`);
      return elapsed;
    };

    for (let index = 0; index < WARMUP_COUNT; index += 1)
      await request(queries[index % queries.length]);
    const durations = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1)
      durations.push(await request(queries[index % queries.length]));

    const rssAfter = process.memoryUsage().rss;
    const result = {
      baseUrl: BASE,
      scale: { entities: ENTITY_COUNT, events: EVENT_COUNT, relations: 0 },
      samples: SAMPLE_COUNT,
      latencyMs: {
        min: Number(Math.min(...durations).toFixed(1)),
        p50: Number(percentile(durations, 0.5).toFixed(1)),
        p95: Number(percentile(durations, 0.95).toFixed(1)),
        max: Number(Math.max(...durations).toFixed(1))
      },
      rssDeltaMiB: mib(Math.max(0, rssAfter - rssBefore)),
      elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(1)),
      gates: {
        p95MsAtMost: MAX_P95_MS,
        rssDeltaMiBAtMost: MAX_RSS_DELTA_MIB
      }
    };
    const passed =
      result.latencyMs.p95 <= MAX_P95_MS && result.rssDeltaMiB <= MAX_RSS_DELTA_MIB;
    console.log(JSON.stringify({ ...result, passed }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    if (worldId) await prisma.world.delete({ where: { id: worldId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`检索基准失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
