#!/usr/bin/env node
/**
 * 页面验收截图脚本（ISS-06 视觉验收工具）：
 *   ① 用治理 API 造一个数据充分的演示世界（跨纪元事件链 + 会终止的关系）
 *   ② 用真实 Chromium 逐页截图到 screenshots/（已 gitignore）
 *
 * 用法：node scripts/ui-shots.mjs [baseUrl]      # 服务需已启动并已 build
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4310';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const api = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(payload).slice(0, 120)}`);
  return payload;
};

// ---------- ① 播种 ----------
const worldName = `验收世界 ${new Date().toISOString().slice(0, 10)}`;
for (const w of (await api('GET', '/api/worlds')).worlds) {
  if (w.name.startsWith('验收世界')) await api('DELETE', `/api/worlds/${w.id}`);
}
const world = (await api('POST', '/api/worlds', { name: worldName, premise: '修行者以梦为舟，渡人间执念；梦界与人间之间曾有通道，如今被人心封死。' })).world;
const W = world.id;
const change = async (kind, payload) => (await api('POST', `/api/worlds/${W}/changes`, { kind, payload })).change.targetUid;

const e1 = await change('epoch_upsert', { name: '蒙昧纪', order: 0, description: '梦界初开，人不知梦' });
const e2 = await change('epoch_upsert', { name: '渡梦纪', order: 1, description: '渡梦者往来两界' });
const e3 = await change('epoch_upsert', { name: '征伐纪', order: 2, description: '通道封死，争端四起' });
const yun = await change('entity_upsert', { kind: 'character', name: '云隐子', summary: '断梦派长老，主张封死通道', content: '云隐子年青时是守梦人的执剑人，后因一次梦界事故转而主张封闭通道。', confidence: 'EXTRACTED', tags: ['长老'], aliases: ['隐子'] });
const xiang = await change('entity_upsert', { kind: 'character', name: '向顶天', summary: '枯井得书的少年', content: '向顶天出身井边村落，因半卷残书入梦界，拜入云隐子门下。', confidence: 'EXTRACTED', tags: ['主角'] });
const guard = await change('entity_upsert', { kind: 'faction', name: '守梦人', summary: '守护梦界通道的组织' });
const broken = await change('entity_upsert', { kind: 'faction', name: '断梦派', summary: '主张切断梦界与人间通道的一派' });
const well = await change('entity_upsert', { kind: 'location', name: '枯井', summary: '残卷埋藏之地' });
const dream = await change('entity_upsert', { kind: 'location', name: '梦界', summary: '由执念构成的另一侧世界' });
const scroll = await change('entity_upsert', { kind: 'item', name: '半卷残书', summary: '记录渡梦之法的残缺典籍' });
const art = await change('entity_upsert', { kind: 'concept', name: '渡梦诀', summary: '以梦为舟的心法' });
const ev1 = await change('event_upsert', { title: '枯井得书', epochUid: e1, epochYear: 3, summary: '向顶天在枯井底拾得半卷残书', participantUids: [xiang], locationUid: well, effectUids: [] });
const ev2 = await change('event_upsert', { title: '初入梦界', epochUid: e1, epochYear: 4, summary: '按残书记载，一夜入梦界', participantUids: [xiang], locationUid: dream, causeUids: [ev1] });
const ev3 = await change('event_upsert', { title: '拜入云隐子门下', epochUid: e2, epochYear: 1, summary: '云隐子收向顶天为徒', participantUids: [xiang, yun], causeUids: [ev2] });
const ev4 = await change('event_upsert', { title: '守梦人誓师', epochUid: e2, epochYear: 2, summary: '守梦人誓师守通道', participantUids: [guard], locationUid: dream });
const ev5 = await change('event_upsert', { title: '断梦派分裂', epochUid: e2, epochYear: 3, summary: '云隐子率断梦派自立', participantUids: [yun, broken], causeUids: [ev4] });
const ev6 = await change('event_upsert', { title: '师徒反目', epochUid: e3, epochYear: 1, summary: '向顶天反对封死通道，与云隐子反目', participantUids: [xiang, yun], locationUid: dream, causeUids: [ev5] });
await change('relation_upsert', { subjectUid: yun, objectUid: xiang, relation: '师徒', polarity: 'establish', eventUid: ev3 });
await change('relation_upsert', { subjectUid: xiang, objectUid: guard, relation: 'member_of', polarity: 'establish', eventUid: ev4 });
await change('relation_upsert', { subjectUid: yun, objectUid: broken, relation: 'member_of', polarity: 'establish', eventUid: ev5 });
await change('relation_upsert', { subjectUid: guard, objectUid: broken, relation: 'rival', polarity: 'establish', eventUid: ev5 });
await change('relation_upsert', { subjectUid: yun, objectUid: xiang, relation: '师徒', polarity: 'terminate', eventUid: ev6 });
await api('POST', `/api/worlds/${W}/merge`, { summary: '验收演示世界' });
await api('POST', `/api/worlds/${W}/manuscripts/import-text`,
  '第一章 枯井\n井底的凉意顺着指缝爬上来。少年摸到半卷残书，纸页像梦一样薄。\n---\n第二章 入梦\n他按书中所记闭目，再睁眼时，脚下是渡梦纪才有的浮桥。\n---\n第三章 反目\n“封死通道，梦就死了。”向顶天说。云隐子没有回头。',
  { 'x-manuscript-title': encodeURIComponent('梦舟记') }).catch(() => {});
await api('POST', `/api/worlds/${W}/foreshadows`, { title: '残卷缺页', detail: '残书缺了下卷，渡梦诀并不完整' });
await api('POST', `/api/worlds/${W}/evals/cases`, { query: '向顶天', expectedUid: xiang });

// ---------- ② 截图 ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const shots = [
  ['01-overview', '/dashboard/overview'],
  ['02-entities', `/dashboard/worlds/${W}/entities`],
  ['03-entity-detail', `/dashboard/worlds/${W}/entities/${xiang}`],
  ['04-events', `/dashboard/worlds/${W}/events`],
  ['05-timeline', `/dashboard/worlds/${W}/timeline`],
  ['06-graph-relations', `/dashboard/worlds/${W}/graph`],
  ['07-graph-relations-slice', `/dashboard/worlds/${W}/graph`],
  ['08-story', `/dashboard/worlds/${W}/story`],
  ['09-assistant', `/dashboard/worlds/${W}/assistant`],
  ['10-lint', `/dashboard/worlds/${W}/lint`],
  ['11-versions', `/dashboard/worlds/${W}/versions`],
  ['12-ops', `/dashboard/worlds/${W}/ops`],
  ['13-sources', `/dashboard/worlds/${W}/sources`],
  ['14-genesis', `/dashboard/worlds/${W}/genesis`],
  ['15-evals', '/dashboard/evals'],
  ['16-skills', '/dashboard/skills']
];
for (const [name, path] of shots) {
  await page.goto(BASE + path);
  await page.waitForTimeout(2600);
  if (name === '07-graph-relations-slice') {
    // 时间切片回放：选到「师徒反目」之后，检查边状态着色
    const options = await page.locator('select').first().locator('option').allTextContents();
    const target = options.find((o) => o.includes('师徒反目'));
    if (target) {
      await page.locator('select').first().selectOption({ label: target });
      await page.waitForTimeout(2200);
    }
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('shot', name, path);
}
console.log(`\n世界：${worldName} (${W})\n截图目录：${OUT}/`);
await browser.close();
