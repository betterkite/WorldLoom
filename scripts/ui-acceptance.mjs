#!/usr/bin/env node
/**
 * 页面验收套件（ISS-06 程序化验收）：
 *   对每个页面执行四类检查——结构（状态码/控制台错误/失败请求）、
 *   几何（横向溢出/文本裁切/元素越界）、可达性（按钮与链接可访问名/输入关联标签）、
 *   视觉证据（2D/WebGL 画布读像素证明真的画了东西）+ 关键交互（节点详情侧栏、ego 邻居、时间切片、弹窗）。
 *
 * 用法：node scripts/ui-acceptance.mjs [baseUrl]
 * 需要：服务已 build 并运行；先用 scripts/ui-shots.mjs 播种演示世界。
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:4310';
const findings = [];
let checks = 0;

const record = (page, level, area, message, verbose = false) => {
  checks += 1;
  findings.push({ page, level, area, message });
  if (level !== 'OK' || verbose) console.log(`  ${level.padEnd(4)} [${page}] ${area}: ${message}`);
};

const TEMPLATE_WORDS = /\b(Documentation|Getting Started|Learn more|Learn how|LEARN MORE|Installation Guide|Skip to content|Submit|Cancel|Save changes|No results|Toggle Sidebar|Toggle theme|Toggle Infobar|Close info panel|Account|Search\.\.\.)\b/;

async function auditPage(page, name, path, options = {}) {
  const consoleErrors = [];
  const failedRequests = [];
  const onConsole = (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); };
  const onResponse = (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) failedRequests.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 80)}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);

  const response = await page.goto(BASE + path);
  await page.waitForTimeout(options.settle ?? 2200);

  record(name, response?.status() === 200 ? 'OK' : 'FAIL', '结构', `HTTP ${response?.status()}`);
  if (consoleErrors.length) record(name, 'FAIL', '结构', `控制台错误 ${consoleErrors.length} 条：${consoleErrors[0]}`);
  if (failedRequests.length) record(name, 'FAIL', '结构', `失败请求：${failedRequests.slice(0, 3).join('; ')}`);

  const geometry = await page.evaluate(() => {
    const language = document.documentElement.lang;
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const vw = document.documentElement.clientWidth;
    const clipped = [];
    const offscreen = [];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const text = (el.textContent ?? '').trim();
      const isLeaf = el.children.length === 0;
      const inCollapsedSidebar = Boolean(el.closest('[data-state="collapsed"], [data-slot="sidebar"][data-collapsed="true"]'));
      const isSrOnly = style.position === 'absolute' && rect.width <= 1 && rect.height <= 1;
      if (
        isLeaf && text.length > 0 && el.scrollWidth > el.clientWidth + 2 &&
        style.overflow !== 'visible' && !el.className.toString().includes('truncate') &&
        !inCollapsedSidebar && !isSrOnly && !el.className.toString().includes('sr-only')
      ) clipped.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]}(${text.slice(0, 18)})`);
      const inSlidePanel = Boolean(el.closest('[data-slot="infobar"], [data-slot="infobar-content"]'));
      if (rect.right > vw + 4 && !inSlidePanel) offscreen.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]}`);
    }
    const brokenImages = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length;
    const namelessButtons = [...document.querySelectorAll('button')].filter(
      (b) => !(b.getAttribute('aria-label') ?? '').trim() && !(b.textContent ?? '').trim() && !b.querySelector('svg title')
    ).length;
    const namelessLinks = [...document.querySelectorAll('a')].filter(
      (a) => !(a.getAttribute('aria-label') ?? '').trim() && !(a.textContent ?? '').trim()
    ).length;
    const labels = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('id') === '') return false;
      const id = el.getAttribute('id');
      const explicit = Boolean(id && document.querySelector(`label[for="${id}"]`));
      const implicit = Boolean(el.closest('label'));
      return !explicit && !implicit;
    }).length;
    const templateHits = (document.body.innerText.match(/\b(Documentation|Getting Started|LEARN MORE|Installation Guide|Skip to content|Toggle Sidebar|Toggle theme|Toggle Infobar|Close info panel)\b/g) ?? []);
    const canvasInfo = [...document.querySelectorAll('canvas')].map((c) => {
      if (c.width < 2 || c.height < 2) return { w: c.width, h: c.height, variance: -1, painted: 0, engine: 'none' };
      const ctx = c.getContext('2d');
      try {
        if (ctx) {
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let min = 255, max = 0, painted = 0;
          for (let i = 0; i < d.length; i += 4 * 37) {
            const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
            if (v < min) min = v;
            if (v > max) max = v;
            if (d[i + 3] > 8) painted += 1;
          }
          return { w: c.width, h: c.height, variance: Math.round(max - min), painted, engine: '2d' };
        }
        // WebGL（Reagraph/three）：readPixels 验证确实绘制（需 preserveDrawingBuffer）
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return { w: c.width, h: c.height, variance: -3, painted: 0, engine: 'unknown' };
        const pixels = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let min = 255, max = 0, painted = 0;
        for (let i = 0; i < pixels.length; i += 4 * 53) {
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
          const v = (r + g + b) / 3;
          if (v < min) min = v;
          if (v > max) max = v;
          if (a > 20 && (Math.abs(r - g) > 12 || Math.abs(g - b) > 12 || r + g + b < 690)) painted += 1;
        }
        return { w: c.width, h: c.height, variance: Math.round(max - min), painted, engine: 'webgl' };
      } catch { return { w: c.width, h: c.height, variance: -2, painted: 0, engine: 'error' }; }
    });
    const svgPaths = document.querySelectorAll('svg path, svg line, svg polyline').length;
    const graphFallback = Boolean(document.querySelector('[data-graph-fallback="true"]'));
    // 画布不得逃逸出容器（Reagraph 画布是 absolute; inset:0，容器必须定位）
    const canvasOverflow = [...document.querySelectorAll('canvas')].some((c) => {
      const parent = c.parentElement?.getBoundingClientRect();
      const self = c.getBoundingClientRect();
      return Boolean(parent && parent.height > 50 && self.height > parent.height + 8);
    });
    return { language, docOverflow, clipped, offscreen: [...new Set(offscreen)], brokenImages, namelessButtons, namelessLinks, unlabeledInputs: labels, templateHits: [...new Set(templateHits)], canvasInfo, svgPaths, graphFallback, canvasOverflow };
  });

  record(name, geometry.language === 'zh-CN' ? 'OK' : 'FAIL', '可访问性', `HTML lang=${geometry.language || '(empty)'}`);
  if (geometry.docOverflow > 2) record(name, 'FAIL', '几何', `页面横向溢出 ${geometry.docOverflow}px`);
  if (geometry.clipped.length) record(name, 'WARN', '几何', `文本被裁切：${geometry.clipped.slice(0, 3).join('; ')}`);
  if (geometry.offscreen.length) record(name, 'WARN', '几何', `元素越出视口：${geometry.offscreen.slice(0, 4).join(', ')}`);
  if (geometry.brokenImages) record(name, 'FAIL', '资源', `破损图片 ${geometry.brokenImages} 张`);
  if (geometry.namelessButtons) record(name, 'WARN', '可达性', `无访问名的按钮 ${geometry.namelessButtons} 个`);
  if (geometry.namelessLinks) record(name, 'WARN', '可达性', `无访问名的链接 ${geometry.namelessLinks} 个`);
  if (geometry.unlabeledInputs) record(name, 'WARN', '可达性', `未关联标签的表单控件 ${geometry.unlabeledInputs} 个`);
  if (geometry.templateHits.length) record(name, 'FAIL', '文案', `模板英文残留：${geometry.templateHits.join(', ')}`);
  if (geometry.canvasOverflow) record(name, 'FAIL', '几何', '画布高度溢出容器（绝对定位逃逸）');
  if (options.expectCanvas) {
    // WebGL 画布优先；无 WebGL 时，产品提供可交互的 SVG 兼容渲染。
    const drawn = geometry.canvasInfo.filter((c) => c.variance > 8 && c.painted > 0);
    const engines = [...new Set(geometry.canvasInfo.map((c) => c.engine))].join('/');
    const detail = `canvas ${geometry.canvasInfo.length} 层（${engines}），实际绘制 ${drawn.length} 层${geometry.graphFallback ? '；SVG 兼容渲染已启用' : ''}`;
    record(name, drawn.length || geometry.graphFallback ? 'OK' : 'FAIL', '视觉证据', detail);
  }
  if (options.expectSvg) {
    record(name, geometry.svgPaths > 0 ? 'OK' : 'FAIL', '视觉证据', `SVG 图元 ${geometry.svgPaths} 个`);
  }
  page.off('console', onConsole);
  page.off('response', onResponse);
  return geometry;
}

async function main() {
  const list = await (await fetch(`${BASE}/api/worlds`)).json();
  const world = (list.worlds ?? []).find((w) => w.name.startsWith('验收世界'));
  if (!world) throw new Error('未找到验收演示世界，请先运行 node scripts/ui-shots.mjs');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const W = world.id;
  console.log(`\nWorldLoom 页面验收 → ${BASE} · 世界「${world.name}」\n`);

  const pages = [
    ['总览', '/dashboard/overview'],
    ['设定条目', `/dashboard/worlds/${W}/entities`],
    ['条目详情', `/dashboard/worlds/${W}/entities/${(await (await fetch(`${BASE}/api/worlds/${W}/entities`)).json()).entities[0].uid}`],
    ['编年史', `/dashboard/worlds/${W}/events`],
    ['时间线', `/dashboard/worlds/${W}/timeline`, { expectSvg: true }],
    ['图谱', `/dashboard/worlds/${W}/graph`, { expectCanvas: true, settle: 4500 }],
    ['故事创作', `/dashboard/worlds/${W}/story`],
    ['世界知识助手', `/dashboard/worlds/${W}/assistant`],
    ['一致性检查', `/dashboard/worlds/${W}/lint`],
    ['版本', `/dashboard/worlds/${W}/versions`],
    ['运行治理', `/dashboard/worlds/${W}/ops`],
    ['素材', `/dashboard/worlds/${W}/sources`],
    ['创世向导', `/dashboard/worlds/${W}/genesis`],
    ['评测平台', '/dashboard/evals'],
    ['技能库', '/dashboard/skills']
  ];
  for (const [name, path, options] of pages) await auditPage(page, name, path, options ?? {});

  // ---- 交互验收 ----
  console.log('\n交互验收：');
  await page.goto(`${BASE}/dashboard/worlds/${W}/graph`);
  await page.waitForTimeout(2600);
  const nodeCountBefore = (await page.locator('canvas').count());
  const graphTypeFilter = page.getByRole('combobox', { name: '节点类型筛选' });
  const pathStart = page.getByRole('combobox', { name: '路径起点' });
  const pathTarget = page.getByRole('combobox', { name: '路径终点' });
  const hasExplorationControls =
    (await graphTypeFilter.count()) === 1 &&
    (await pathStart.count()) === 1 &&
    (await pathTarget.count()) === 1;
  record(
    '图谱交互',
    hasExplorationControls ? 'OK' : 'FAIL',
    '图谱进阶控件',
    `类型筛选=${await graphTypeFilter.count()} 路径控件=${await pathStart.count()}/${await pathTarget.count()}`,
    true
  );
  const pathOptions = await pathStart.locator('option').evaluateAll((options) =>
    options.map((option) => option.value).filter(Boolean)
  );
  if (pathOptions.length >= 2) {
    await pathStart.selectOption(pathOptions[0]);
    await pathTarget.selectOption(pathOptions[1]);
    await page.waitForTimeout(500);
    const pathText = await page.locator('text=/已找到|没有连通路径/').first().innerText().catch(() => '');
    record(
      '图谱交互',
      /已找到|没有连通路径/.test(pathText) ? 'OK' : 'FAIL',
      '路径查找',
      pathText || '选择两个节点后没有显示路径结果',
      true
    );
    await page.getByRole('button', { name: '清除' }).click();
  } else {
    record('图谱交互', 'WARN', '路径查找', `可选节点不足（${pathOptions.length}）`);
  }
  const overviewButton = page.getByRole('button', { name: '总览', exact: true });
  if (await overviewButton.count()) {
    await overviewButton.click();
    await page.waitForTimeout(1200);
    const collapseToggle = page.getByLabel('折叠社区');
    record(
      '图谱交互',
      (await collapseToggle.count()) === 1 ? 'OK' : 'FAIL',
      '社区折叠',
      `折叠控件=${await collapseToggle.count()}`,
      true
    );
    if (await collapseToggle.count()) {
      await collapseToggle.check();
      await page.waitForTimeout(600);
      const collapsedText = await page.locator('text=/社区 \\d+ · \\d+ 项/').count();
      record('图谱交互', collapsedText > 0 ? 'OK' : 'WARN', '社区折叠', `聚类节点文案=${collapsedText}`, true);
    }
  }

  await page.goto(`${BASE}/dashboard/worlds/${W}/graph`);
  await page.waitForTimeout(2600);
  // 交互 A：点关系清单一行 → 右侧节点详情侧边栏 → 只看邻居 → 返回全图
  const relationRow = page.locator('button').filter({ hasText: /师徒|盟友|member_of|rival|敌人|联姻/ }).first();
  if (await relationRow.count()) {
    await relationRow.click();
    await page.waitForTimeout(1200);
    const asideText = await page.locator('aside').innerText().catch(() => '');
    const hasPanel = asideText.includes('关系（') && asideText.includes('只看它的邻居');
    record('图谱交互', hasPanel ? 'OK' : 'FAIL', '节点详情侧边栏', hasPanel ? `侧栏首行：${asideText.split('\n').filter(Boolean)[0]}` : '点关系行后侧栏未出现详情', true);
    if (hasPanel) {
      await page.getByRole('button', { name: '只看它的邻居' }).click();
      await page.waitForTimeout(1000);
      const egoOn = await page.getByRole('button', { name: /返回全图/ }).isVisible().catch(() => false);
      if (egoOn) await page.getByRole('button', { name: /返回全图/ }).click();
      await page.waitForTimeout(600);
      const egoOff = !(await page.getByRole('button', { name: /返回全图/ }).isVisible().catch(() => false));
      record('图谱交互', egoOn && egoOff ? 'OK' : 'WARN', 'ego 邻居视图', `进入=${egoOn} 返回=${egoOff}`, true);
    }
  } else {
    record('图谱交互', 'WARN', '节点详情侧边栏', '未找到关系清单行', true);
  }

  await page.goto(`${BASE}/dashboard/worlds/${W}/graph`);
  await page.waitForTimeout(2400);
  const sliceSelect = page.locator('label', { hasText: '时间切片' }).locator('select');
  const sliceOptions = await sliceSelect.locator('option').allTextContents();
  const target = sliceOptions.find((o) => o.includes('师徒反目'));
  if (target) {
    await sliceSelect.selectOption({ label: target });
    await page.waitForTimeout(2000);
    const stateBadges = page.getByText(/该时刻前已终结|该时刻之后才发生|该时刻有效/);
    const stateCount = await stateBadges.count();
    const stateSample = stateCount ? (await stateBadges.first().innerText()).trim() : '';
    const hasState = stateCount > 0 && /该时刻/.test(stateSample);
    record('图谱交互', hasState ? 'OK' : 'WARN', '时间切片', hasState ? `${stateCount} 条边带状态徽标（示例：${stateSample.slice(0, 16)}）` : '选择「师徒反目」后未见状态徽标', true);
  } else {
    record('图谱交互', 'WARN', '时间切片', `未找到锚点事件选项（共 ${sliceOptions.length} 项）`);
  }

  await page.goto(`${BASE}/dashboard/worlds/${W}/timeline`);
  await page.waitForTimeout(2400);
  const scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 50 && e.clientWidth > 300);
    if (!el) return null;
    const before = el.scrollLeft;
    el.scrollLeft = before + 120;
    return { changed: el.scrollLeft !== before, width: el.scrollWidth };
  });
  if (scrolled) {
    record('时间线交互', scrolled.changed ? 'OK' : 'WARN', '横向滚动', `可滚动容器 scrollWidth=${scrolled.width}`, true);
  } else {
    // 数据量小时时间线不出滚动条属正常：改为校验纪元/事件确实渲染
    const rendered = await page.evaluate(() => /(纪)/.test(document.body.innerText) && document.querySelectorAll('svg').length > 0);
    record('时间线交互', rendered ? 'OK' : 'WARN', '内容渲染', rendered ? '无溢出（数据量小）但纪元与 SVG 均渲染' : '未见纪元或 SVG 内容', true);
  }

  await page.goto(`${BASE}/dashboard/worlds/${W}/entities`);
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /新建条目/ }).click();
  const dialogOpen = await page.getByText('新建设定条目').isVisible().catch(() => false);
  await page.getByRole('button', { name: '取消' }).first().click();
  await page.waitForTimeout(600);
  const dialogClosed = !(await page.getByText('新建设定条目').isVisible().catch(() => false));
  record('弹窗交互', dialogOpen && dialogClosed ? 'OK' : 'FAIL', '条目弹窗', `打开=${dialogOpen} 取消关闭=${dialogClosed}`, true);

  await browser.close();

  const fails = findings.filter((f) => f.level === 'FAIL');
  const warns = findings.filter((f) => f.level === 'WARN');
  console.log(`\n==== 页面验收：检查 ${checks} 项 · FAIL ${fails.length} · WARN ${warns.length} ====`);
  for (const f of fails) console.log('FAIL', `[${f.page}] ${f.area}: ${f.message}`);
  console.log(JSON.stringify({ checks, fails: fails.length, warns: warns.length }));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('验收中断：', e.message); process.exit(1); });
