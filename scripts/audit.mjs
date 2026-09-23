#!/usr/bin/env node
/**
 * WorldLoom 全量可用性审计（API + 页面冒烟，非 LLM 步骤为主）。
 *
 * 用法（服务需已启动）：
 *   node scripts/audit.mjs            # 默认 http://localhost:4310
 *   node scripts/audit.mjs http://other:4310
 *
 * 覆盖：治理链播种（epoch/entity/event/relation → merge）· 作品导入 · 伏笔 ·
 * 检索评测用例与跑分 · 全部读 API · 导出 ZIP/JSON · MCP · 全部页面路由。
 * 任何 FAIL 以退出码 1 结束；审计世界留在库中供控制台查看（可重复运行，自动清理旧审计世界）。
 */

const BASE = process.argv[2] ?? 'http://localhost:4310';
let failures = 0;
const results = [];

async function call(method, path, body, headers, raw) {
  const h = { ...(headers ?? {}) };
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string') payload = body;
    else {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
  }
  const response = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  const text = await response.text();
  return { status: response.status, body: raw ? text : (() => { try { return JSON.parse(text); } catch { return {}; } })() };
}

function step(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`\nWorldLoom 可用性审计 → ${BASE}\n`);

  // 清理旧审计世界
  const { body: list } = await call('GET', '/api/worlds');
  for (const w of list.worlds ?? []) {
    if (w.name.startsWith('审计世界')) await call('DELETE', `/api/worlds/${w.id}`);
  }

  // 播种
  const created = await call('POST', '/api/worlds', { name: '审计世界-脚本', premise: '审计用测试世界' });
  const worldId = created.body.world.id;
  step('seed.world', [200, 201].includes(created.status));

  const change = async (kind, payload) => {
    const r = await call('POST', `/api/worlds/${worldId}/changes`, { kind, payload });
    if (![200, 201, 202].includes(r.status)) throw new Error(`${kind}: ${r.status}`);
    return r.body.change.targetUid;
  };
  const e1 = await change('epoch_upsert', { name: '创世纪', order: 0 });
  await change('epoch_upsert', { name: '征伐纪', order: 1 });
  const yun = await change('entity_upsert', { kind: 'character', name: '云隐子', summary: '断梦派长老' });
  const xiang = await change('entity_upsert', { kind: 'character', name: '向顶天', summary: '得书入梦的少年' });
  const smr = await change('entity_upsert', { kind: 'faction', name: '守梦人', summary: '守护梦界的组织' });
  const jing = await change('entity_upsert', { kind: 'location', name: '枯井', summary: '残卷埋藏之地' });
  const ev1 = await change('event_upsert', { title: '云隐子夜授残卷', epochUid: e1, epochYear: 3, participantUids: [yun], locationUid: jing });
  await change('event_upsert', { title: '向顶天得书入梦', epochUid: e1, epochYear: 4, participantUids: [xiang], causeUids: [ev1] });
  await change('event_upsert', { title: '守梦人誓师', epochUid: e1, epochYear: 5, participantUids: [smr] });
  await change('relation_upsert', { subjectUid: yun, objectUid: xiang, relation: '师徒', polarity: 'establish', eventUid: ev1 });
  step('seed.changes', true, '10 changes');
  const merged = await call('POST', `/api/worlds/${worldId}/merge`, { summary: '审计播种合并' });
  step('seed.merge', [200, 201, 202].includes(merged.status), `冲突 ${merged.body.conflictCount}`);

  const imported = await call('POST', `/api/worlds/${worldId}/manuscripts/import-text`,
    '第一章 残卷\n云隐子在枯井底拾得半卷残书。\n第二章 入梦\n向顶天按图索骥，一夜入梦界。',
    { 'x-manuscript-title': encodeURIComponent('审计作品') }, true);
  step('seed.manuscript', [200, 201, 202].includes(imported.status));
  step('seed.foreshadow', [200, 201, 202].includes(
    (await call('POST', `/api/worlds/${worldId}/foreshadows`, { title: '残卷之谜', detail: '残卷缺了下卷' })).status));
  step('seed.evalcase', [200, 201, 202].includes(
    (await call('POST', `/api/worlds/${worldId}/evals/cases`, { query: '向顶天', expectedUid: xiang })).status));

  // 读 API 冒烟
  const gets = [
    ['api.detail', `/api/worlds/${worldId}`], ['api.epochs', `/api/worlds/${worldId}/epochs`],
    ['api.entities', `/api/worlds/${worldId}/entities`], ['api.events', `/api/worlds/${worldId}/events`],
    ['api.relations', `/api/worlds/${worldId}/relations`], ['api.timeline', `/api/worlds/${worldId}/timeline`],
    ['api.graph', `/api/worlds/${worldId}/graph`], ['api.lint', `/api/worlds/${worldId}/lint`],
    ['api.versions', `/api/worlds/${worldId}/versions`], ['api.changes', `/api/worlds/${worldId}/changes`],
    ['api.manuscripts', `/api/worlds/${worldId}/manuscripts`], ['api.sources', `/api/worlds/${worldId}/sources`],
    ['api.foreshadows', `/api/worlds/${worldId}/foreshadows`], ['api.qa', `/api/worlds/${worldId}/qa`],
    ['api.evals', `/api/worlds/${worldId}/evals`], ['api.evals.cases', `/api/worlds/${worldId}/evals/cases`],
    ['api.ops', `/api/worlds/${worldId}/ops`], ['api.entity.detail', `/api/worlds/${worldId}/entities/${xiang}`]
  ];
  for (const [name, path] of gets) {
    const r = await call('GET', path);
    step(name, r.status === 200, String(r.status));
  }

  const searched = await call('POST', `/api/worlds/${worldId}/search`, { query: '向顶天' });
  step('api.search', searched.status === 200 && (searched.body.hits?.length ?? 0) > 0,
    `mode=${searched.body.mode} hits=${searched.body.hits?.length ?? 0}`);
  const lint = await call('POST', `/api/worlds/${worldId}/lint`, {});
  step('api.lint.run', lint.status === 200, JSON.stringify(lint.body.counts ?? {}));
  const zip = await call('GET', `/api/worlds/${worldId}/export`, undefined, undefined, true);
  step('api.export.zip', zip.status === 200 && zip.body.length > 500, `${zip.body.length}B`);
  step('api.export.json', (await call('GET', `/api/worlds/${worldId}/export/json`)).status === 200);
  const mcp = await call('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  step('api.mcp.tools', mcp.status === 200);
  const evalRun = await call('POST', `/api/worlds/${worldId}/evals`, { cases: [{ query: '向顶天', expectedUid: xiang }] });
  step('api.eval.run', [200, 202].includes(evalRun.status), `score=${evalRun.body.score}`);

  // 页面冒烟
  const pages = [
    ['page.home', '/'], ['page.dashboard', '/dashboard'], ['page.overview', '/dashboard/overview'],
    ['page.skills', '/dashboard/skills'], ['page.evals', '/dashboard/evals']
  ];
  for (const [name, p] of pages) {
    const r = await fetch(`${BASE}${p}`);
    const text = await r.text();
    step(name, r.status === 200 && text.length > 1000, `${r.status} ${text.length}B`);
  }
  for (const [name, p] of [
    ['page.w.home', ''], ['page.w.entities', '/entities'], ['page.w.entity.detail', `/entities/${xiang}`],
    ['page.w.events', '/events'], ['page.w.timeline', '/timeline'], ['page.w.story', '/story'],
    ['page.w.assistant', '/assistant'], ['page.w.graph', '/graph'], ['page.w.genesis', '/genesis'],
    ['page.w.review', '/review'], ['page.w.lint', '/lint'], ['page.w.manuscript', '/manuscript'],
    ['page.w.sources', '/sources'], ['page.w.ops', '/ops'], ['page.w.versions', '/versions']
  ]) {
    const r = await fetch(`${BASE}/dashboard/worlds/${worldId}${p}`);
    const text = await r.text();
    step(name, r.status === 200 && text.length > 1000, `${r.status} ${text.length}B`);
  }

  console.log(`\n==== 总计 ${results.length} 项，失败 ${failures} ====`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('审计中断：', error.message);
  process.exit(1);
});
