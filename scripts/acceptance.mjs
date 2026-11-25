#!/usr/bin/env node
/**
 * A6-5 真实模型链路检查（不代替人工内容质量复核）。
 * node scripts/acceptance.mjs [baseUrl] [--keep-world]
 * 默认仅清理本次创建的 UUID fixture；--keep-world 显式保留供人工复核。
 * 所有请求有界，不自动重试写操作/付费生成，不输出 provider 原文。
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class AcceptanceError extends Error {}

export function parseAcceptanceOptions(args) {
  const options = {
    baseUrl: 'http://localhost:4310', keepWorld: false,
    requestTimeoutMs: 180_000, compileTimeoutMs: 180_000, pollIntervalMs: 500
  };
  let hasUrl = false;
  for (const arg of args.filter((item) => item !== '--')) {
    if (arg === '--keep-world') options.keepWorld = true;
    else if (/^--(request|compile)-timeout-ms=\d+$/.test(arg)) {
      const [flag, value] = arg.split('=');
      const milliseconds = Number(value);
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000 || milliseconds > 600_000) {
        throw new AcceptanceError('timeout must be an integer between 1000 and 600000 ms');
      }
      options[flag === '--request-timeout-ms' ? 'requestTimeoutMs' : 'compileTimeoutMs'] = milliseconds;
    } else if (!arg.startsWith('-') && !hasUrl) {
      options.baseUrl = arg;
      hasUrl = true;
    } else throw new AcceptanceError('unknown acceptance argument');
  }
  const url = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new AcceptanceError('baseUrl must be an HTTP(S) origin without credentials');
  }
  options.baseUrl = url.origin;
  return options;
}

export async function runAcceptance(options, { fetchFn = fetch, log = console.log } = {}) {
  let failures = 0;
  let worldId = null;
  let compileRunId = null;
  const fixtureName = `验收世界-${randomUUID()}`;
  const premise = '一个修行者以梦为舟、渡人间执念的世界。';
  const results = [];
  const step = (name, ok, detail = '') => {
    results.push({ name, ok });
    if (!ok) failures += 1;
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };
  const reason = (error) => {
    if (error instanceof AcceptanceError) return error.message;
    // Diagnostic categories are safe; arbitrary messages, URLs and bodies are not.
    const category = ['TimeoutError', 'AbortError', 'SyntaxError', 'TypeError', 'RangeError'].includes(error?.name)
      ? error.name : 'Error';
    const cause = ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT'].includes(error?.cause?.code)
      ? `/${error.cause.code}` : '';
    return `请求超时、网络或响应格式异常（${category}${cause}；原文未输出）`;
  };
  const require = (condition, message) => { if (!condition) throw new AcceptanceError(message); };
  const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const sleep = () => new Promise((done) => setTimeout(done, options.pollIntervalMs));
  const request = async (method, path, body, timeoutMs = options.requestTimeoutMs) => {
    const response = await fetchFn(`${options.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)))
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AcceptanceError(`${method} ${path}: HTTP ${response.status}`);
    }
    return response;
  };
  const call = async (method, path, body, timeoutMs) => (await request(method, path, body, timeoutMs)).json();
  const worldPath = () => `/api/worlds/${worldId}`;
  const readWorld = async () => (await call('GET', worldPath())).world;
  const checkedMerge = async (summary, before) => {
    await call('POST', `${worldPath()}/merge`, { summary });
    const after = await readWorld();
    require(after.masterVersion > before.masterVersion, '合并没有追加正史版本');
    return after;
  };
  log('\nWorldLoom A6-5 真实模型自动化链路检查（另需人工质量复核）\n');
  try {
    const health = await call('GET', '/api/health');
    require(step('0.1 服务健康', health.status === 'ok'), '服务健康检查失败');
    const active = (health.llm?.profiles ?? []).find((profile) => profile.profileId === health.llm?.defaultProfile);
    if (!step('0.2 默认模型连通', Boolean(active?.configured && active?.detected))) {
      log('  SKIP  模型不可用；未创建 fixture、未发起生成。');
      return { failures, worldId, results };
    }
    const embedding = health.llm?.embeddings;
    const embeddingsReady = Boolean((embedding?.enabled && embedding.configured) || embedding?.local?.available);
    step('0.3 检索配置', true, embeddingsReady ? '验收语义索引' : '仅验收词法降级');
    const created = await call('POST', '/api/worlds', { name: fixtureName, premise, ingestMode: 'review' });
    require(validId(created.world?.id), '创建世界响应缺少有效 ID，无法安全清理');
    worldId = created.world.id;
    require(created.world.name === fixtureName, '创建世界响应与本次 fixture 不一致');
    step('1.1 创建唯一世界', true);

    const stage = async (name, execute) => {
      try { await execute(); } catch (error) {
        step(name, false, reason(error));
        // Stop an owned background compile promptly, not after later model calls.
        if (compileRunId) {
          try {
            await call('POST', `${worldPath()}/compile-runs/${compileRunId}/cancel`);
            compileRunId = null;
            step('cleanup.compile', true, '已请求取消本次任务');
          } catch (cancelError) { step('cleanup.compile', false, reason(cancelError)); }
        }
      }
    };
    await stage('2. 创世链路', async () => {
      const before = await readWorld();
      const { plan } = await call('POST', `${worldPath()}/genesis/plan`, { premise, style: '东方仙侠，苍凉厚重' });
      require(Array.isArray(plan?.epochs) && plan.epochs.length > 0, '创世规划缺少纪元');
      step('2.1 创世规划', true, `纪元 ${plan.epochs.length}`);
      const generated = await call('POST', `${worldPath()}/genesis/commit`, { premise, style: '东方仙侠', plan });
      require(generated.staged > 0, '创世没有生成待审变更');
      const staged = await readWorld();
      require(staged.masterVersion === before.masterVersion && staged.pendingChanges > 0, '创世没有保持先审阅后合并边界');
      step('2.2 创世生成仅入待审', true, `${generated.staged} 条变更`);
      const after = await checkedMerge('合成验收：创世合并', before);
      step('2.3 合并追加版本', after.master.entities > 0 && after.master.events > 0);
    });
    await stage('3. 素材编译', async () => {
      const before = await readWorld();
      const { source } = await call('POST', `${worldPath()}/sources`, {
        filename: '合成增量设定.md',
        content: '渡梦历三年，守梦人内部出现「断梦派」，主张切断梦界与人间的通道。向顶天的师父云隐子正是断梦派长老。'
      });
      require(validId(source?.id), '素材响应缺少有效 ID');
      const queued = await call('POST', `${worldPath()}/sources/${source.id}/compile`);
      require(validId(queued.runId), '编译响应缺少有效 run ID');
      compileRunId = queued.runId;
      const deadline = Date.now() + options.compileTimeoutMs;
      let run;
      while (Date.now() < deadline) {
        ({ run } = await call('GET', `${worldPath()}/compile-runs/${compileRunId}`, undefined, Math.min(deadline - Date.now(), options.requestTimeoutMs)));
        if (run?.status === 'completed') break;
        require(!['failed', 'cancelled'].includes(run?.status), '编译任务失败或取消（原文未输出）');
        await sleep();
      }
      require(run?.status === 'completed', '编译任务轮询超时');
      compileRunId = null;
      require(run.result?.staged > 0, '增量编译没有待审变更');
      const staged = await readWorld();
      require(staged.masterVersion === before.masterVersion && staged.pendingChanges > 0, '增量编译没有保持待审边界');
      step('3.1 编译完成且仅入待审', true, `${run.result.staged} 条变更`);
      const usage = run.usage ?? {};
      step('3.2 编译用量完整', usage.usageComplete === true && Number.isFinite(usage.totalTokens),
        Number.isFinite(usage.totalTokens) ? `${usage.totalTokens} tokens` : '未知用量不记作零');
      await checkedMerge('合成验收：增量设定合并', before);
      step('3.3 增量合并追加版本', true);
    });
    await stage('4. Lint', async () => {
      const lint = await call('POST', `${worldPath()}/lint`);
      step('4.1 一致性体检', lint.version > 0 && typeof lint.counts === 'object');
    });
    await stage('5. 检索与问答', async () => {
      const search = await call('POST', `${worldPath()}/search`, { query: '向顶天' });
      step('5.1 设定检索', (search.hits?.length ?? 0) > 0);
      const ask = await call('POST', `${worldPath()}/ask`, { question: '向顶天的师父是谁？他和守梦人是什么关系？' });
      const cited = Array.isArray(ask.citations) && ask.citations.some((item) =>
        Number.isInteger(item.n) && item.n > 0 && validId(item.uid) && String(ask.answer).includes(`[${item.n}]`));
      const honest = /未找到足够依据/.test(ask.answer ?? '');
      step('5.2 答案引用或无证据声明', cited || honest, cited ? '含对应引用标记（仍需人工核对内容）' : '无证据声明');
    });
    await stage('6. 推演', async () => {
      const before = await readWorld();
      const generated = await call('POST', `${worldPath()}/continuations`, { instruction: '往危机方向推' });
      const candidates = generated.candidates ?? [];
      require(candidates.length > 0, '推演没有候选');
      step('6.1 推演候选', true, `${candidates.length} 条`);
      const candidate = candidates.find((item) => item.kind === 'event_suggestion') ?? candidates[0];
      require(validId(candidate.id), '推演候选缺少有效 ID');
      const accepted = await call('POST', `${worldPath()}/continuations/${candidate.id}/accept`);
      const staged = await readWorld();
      require(accepted.acceptedChangeUid && staged.masterVersion === before.masterVersion && staged.pendingChanges > 0, '采纳没有转入待审边界');
      step('6.2 采纳仅入待审', true);
      await checkedMerge('合成验收：推演采纳合并', before);
      step('6.3 推演合并追加版本', true);
    });
    if (embeddingsReady) await stage('7. 语义检索', async () => {
      await call('POST', `${worldPath()}/semantic-index`);
      const deadline = Date.now() + options.compileTimeoutMs;
      let state;
      while (Date.now() < deadline) {
        state = await call('GET', `${worldPath()}/semantic-index`, undefined, Math.min(options.requestTimeoutMs, deadline - Date.now()));
        if (state.semantic?.fresh && state.semantic.indexed > 0) break;
        require(state.job?.status !== 'failed', '语义索引任务失败（原文未输出）');
        await sleep();
      }
      require(state?.semantic?.fresh && state.semantic.indexed > 0, '语义索引未在期限内就绪');
      const search = await call('POST', `${worldPath()}/search`, { query: '渡梦的人是谁' });
      step('7.1 就绪语义索引与 hybrid 命中', search.mode === 'hybrid' && search.semantic?.fresh === true && (search.hits?.length ?? 0) > 0);
    });
    else log('  SKIP  7. 语义检索未配置；这不是语义增强通过证据。');
    await stage('8. 导出', async () => {
      const response = await request('GET', `${worldPath()}/export`);
      const buffer = Buffer.from(await response.arrayBuffer());
      step('8.1 Obsidian 导出', buffer.subarray(0, 2).toString() === 'PK' && buffer.length > 1000, `${buffer.length} bytes`);
    });
    await stage('8.2 MCP', async () => {
      const mcp = await call('POST', '/api/mcp', {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'query_world', arguments: { worldId, query: '向顶天' } }
      });
      require(!mcp.error && !mcp.result?.isError, 'MCP 返回错误');
      const hits = JSON.parse(mcp.result?.content?.[0]?.text ?? '{}');
      step('8.2 MCP query_world', (hits.hits?.length ?? 0) > 0);
    });
  } catch (error) {
    step('验收前置或创建', false, reason(error));
  } finally {
    if (worldId) {
      try {
        const owned = await readWorld();
        require(owned?.id === worldId && owned.name === fixtureName, 'fixture 身份不匹配；拒绝清理');
        if (compileRunId) {
          await call('POST', `${worldPath()}/compile-runs/${compileRunId}/cancel`);
          step('cleanup.compile', true, '已请求取消本次任务');
        }
        if (options.keepWorld) log(`  KEEP  本次 fixture ${worldId}，供人工复核；不是发布质量批准。`);
        else {
          await call('DELETE', worldPath());
          const absent = await fetchFn(`${options.baseUrl}${worldPath()}`, {
            signal: AbortSignal.timeout(options.requestTimeoutMs)
          });
          await absent.body?.cancel();
          step('cleanup.world', absent.status === 404, absent.status === 404 ? '已删除本次 fixture' : '删除后未确认 404');
        }
      } catch (error) { step('cleanup.world', false, reason(error)); }
    }
    log(`\n自动化链路检查：${failures} 项失败；人工内容质量、实际部署门禁另行验收。\n`);
  }
  return { failures, worldId, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runAcceptance(parseAcceptanceOptions(process.argv.slice(2)));
    process.exitCode = result.failures > 0 ? 1 : 0;
  } catch {
    console.error('验收参数无效；使用 [HTTP(S) origin] [--keep-world] [--request-timeout-ms=N] [--compile-timeout-ms=N]。');
    process.exitCode = 1;
  }
}
