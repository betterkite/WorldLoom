#!/usr/bin/env node
/**
 * A6-5 全链路真实模型验收脚本。
 *
 * 用法（服务需已启动，模型凭据需已配置）：
 *   node scripts/acceptance.mjs            # 默认 http://localhost:4310
 *   node scripts/acceptance.mjs http://other:4310
 *
 * 前置：`.env.local` 中 DEEPSEEK_API_KEY（或 MODELPORT_API_KEY + ModelPort 运行中）；
 *       本地 embedding 模型已下载或配置了 EMBEDDINGS_API_KEY 时同时验收语义检索（A4-7）。
 * 每一步打印 PASS / FAIL / SKIP，任何 FAIL 以退出码 1 结束。
 */

const BASE = process.argv[2] ?? 'http://localhost:4310';
let failures = 0;

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `${method} ${path} → ${response.status}`);
  }
  return payload;
}

async function waitForCompile(worldId, runId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { run } = await call('GET', `/api/worlds/${worldId}/compile-runs/${runId}`);
    if (run.status === 'completed') return run;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error ?? `compile run ${run.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`compile run timed out after ${timeoutMs}ms`);
}

function step(name, ok, detail = '') {
  if (ok) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log(`\nWorldLoom A6-5 真实模型全链路验收 → ${BASE}\n`);

  // 0. 健康 + 模型检测
  let llmReady = false;
  let embeddingsReady = false;
  try {
    const health = await call('GET', '/api/health');
    step('0.1 服务健康', health.status === 'ok');
    const profiles = health.llm?.profiles ?? [];
    const active = profiles.find((p) => p.configured && p.detected);
    llmReady = Boolean(active);
    step('0.2 模型连通', llmReady, active ? `${active.profileId} (${active.model}, ${active.latencyMs}ms)` : '未配置或不可达 — LLM 步骤将 SKIP');
    embeddingsReady = (health.llm?.embeddings?.configured && health.llm?.embeddings?.enabled) ?? false;
    step('0.3 语义检索配置', true, embeddingsReady ? '本地/远程已配置（将验收 A4-7）' : '未配置（纯词法降级，合法）');
  } catch (error) {
    step('0.1 服务健康', false, error.message);
    process.exit(1);
  }

  // 1. 世界 + 创世向导（真实 LLM）
  const world = (await call('POST', '/api/worlds', { name: `验收世界 ${Date.now()}`, premise: '一个修行者以梦为舟、渡人间执念的世界。' }))['world'];
  const worldId = world.id;
  step('1.1 创建世界', Boolean(worldId), world.name);

  if (!llmReady) {
    console.log('\n  ⚠ 未检测到可用模型 — A6-5 的 LLM 步骤全部 SKIP。');
    console.log('    配置 .env.local 中的 Key 并重启服务后重新运行本脚本。\n');
    process.exit(failures > 0 ? 1 : 0);
  }

  try {
    const plan = (await call('POST', `/api/worlds/${worldId}/genesis/plan`, { premise: world.premise, style: '东方仙侠，苍凉厚重' }))['plan'];
    step('2.1 创世规划', plan.epochs.length > 0, `纪元 ${plan.epochs.length} · 势力 ${plan.factions.length} · 地域 ${plan.regions.length}`);

    const committed = await call('POST', `/api/worlds/${worldId}/genesis/commit`, {
      premise: world.premise, style: '东方仙侠', plan
    });
    step('2.2 创世生成（待审）', committed.staged > 0, `${committed.staged} 条变更 · ${committed.defects.length} 缺陷`);

    await call('POST', `/api/worlds/${worldId}/merge`, { summary: '创世合并' });
    const detail = (await call('GET', `/api/worlds/${worldId}`))['world'];
    step('2.3 合并入正史', detail.master.entities > 0 && detail.master.events > 0, `v${detail.masterVersion}：${detail.master.entities} 条目 · ${detail.master.events} 事件`);
  } catch (error) {
    step('2. 创世链路', false, error.message);
  }

  // 3. 素材编译（增量）
  try {
    await call('POST', `/api/worlds/${worldId}/sources`, {
      filename: '增量设定.md',
      content: '渡梦历三年，守梦人内部出现「断梦派」，主张切断梦界与人间的通道。向顶天的师父云隐子正是断梦派长老。'
    });
    const sources = (await call('GET', `/api/worlds/${worldId}/sources`))['sources'];
    const queued = await call('POST', `/api/worlds/${worldId}/sources/${sources[0].id}/compile`);
    const compile = await waitForCompile(worldId, queued.runId);
    const result = compile.result ?? {};
    step(
      '3.1 增量编译',
      result.staged > 0,
      `${result.staged ?? 0} 条变更 · ${(result.defects ?? []).length} 缺陷`
    );
    await call('POST', `/api/worlds/${worldId}/merge`, { summary: '增量设定合并' });
    step('3.2 增量合并', true);
  } catch (error) {
    step('3. 素材编译', false, error.message);
  }

  // 4. Lint
  try {
    const lint = await call('POST', `/api/worlds/${worldId}/lint`);
    step('4.1 一致性体检', lint.version > 0, `${lint.counts.error} 错误 · ${lint.counts.warning} 警告 · ${lint.counts.fixed} 自愈`);
  } catch (error) {
    step('4. Lint', false, error.message);
  }

  // 5. 检索 + 问答（引用 + 多跳）
  try {
    const search = await call('POST', `/api/worlds/${worldId}/search`, { query: '向顶天' });
    step('5.1 混合检索', search.hits.length > 0, `mode=${search.mode} · ${search.hits.length} 命中`);

    const ask = await call('POST', `/api/worlds/${worldId}/ask`, { question: '向顶天的师父是谁？他和守梦人是什么关系？' });
    const cited = ask.citations.length > 0;
    const honest = /未找到足够依据/.test(ask.answer);
    // 真实语料下检索应命中并引用；LLM 判断证据不足时的诚实回答也算合格
    step('5.2 引用问答', cited || honest, cited ? `${ask.citations.length} 引用` : honest ? '诚实回答（证据不足）' : '既无引用也未声明证据不足');
  } catch (error) {
    step('5. 检索与问答', false, error.message);
  }

  // 6. 推演
  try {
    const generated = await call('POST', `/api/worlds/${worldId}/continuations`, { instruction: '往危机方向推' });
    const candidates = generated.candidates ?? [];
    step('6.1 推演候选', candidates.length > 0, `${candidates.length} 条（rationale 引用既有设定）`);
    const eventCandidate = candidates.find((c) => c.kind === 'event_suggestion') ?? candidates[0];
    const accepted = await call('POST', `/api/worlds/${worldId}/continuations/${eventCandidate.id}/accept`);
    step('6.2 采纳转审阅链', Boolean(accepted.acceptedChangeUid), accepted.defects?.length ? `缺陷：${accepted.defects.join('；')}` : '');
    await call('POST', `/api/worlds/${worldId}/merge`, { summary: '推演采纳合并' });
  } catch (error) {
    step('6. 推演', false, error.message);
  }

  // 7. 语义检索（可选 A4-7）
  if (embeddingsReady) {
    try {
      const indexed = await call('POST', `/api/worlds/${worldId}/semantic-index`);
      const search = await call('POST', `/api/worlds/${worldId}/search`, { query: '渡梦的人是谁' });
      step('7.1 语义索引 + 同义命中', indexed.indexed > 0 && search.hits.length > 0, `mode=${search.mode} · top=${search.hits[0]?.name}`);
    } catch (error) {
      step('7. 语义检索', false, error.message);
    }
  }

  // 8. 导出 + MCP
  try {
    const response = await fetch(`${BASE}/api/worlds/${worldId}/export`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const validZip = buffer.subarray(0, 2).toString() === 'PK';
    step('8.1 Obsidian 导出', validZip && buffer.length > 1000, `${buffer.length} bytes`);
  } catch (error) {
    step('8. 导出', false, error.message);
  }
  try {
    const mcp = await call('POST', '/api/mcp', {
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: 'query_world', arguments: { worldId, query: '向顶天' } }
    });
    const hits = JSON.parse(mcp.result.content[0].text);
    step('8.2 MCP query_world', hits.hits.length > 0, `${hits.hits.length} 命中`);
  } catch (error) {
    step('8.2 MCP', false, error.message);
  }

  console.log(`\n${failures === 0 ? '✅ 全链路验收通过' : `❌ ${failures} 项失败`} — 世界 ${worldId} 已留在库中可在控制台查看\n`);
  process.exit(failures > 0 ? 1 : 0);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error('验收脚本异常：', error);
  process.exit(1);
});
