import type { ChatMessage } from '@/lib/llm/client';

/**
 * Prompt builders for the worldbuilding compiler. Kept as pure functions so
 * tests can assert on prompt contents without a live LLM.
 */

const SYSTEM_COMPILER = `你是世界观编译器（World Compiler）。你的职责是把原始素材或创世规划编译成结构化、自洽的世界观条目与编年史事件。
输出必须是严格的 JSON 对象，不带任何解释、markdown 代码块或多余文本。
所有引用一律使用名称（中文名精确匹配），不要发明 uid。
置信度标注规则：素材明确支持的用 EXTRACTED；由素材合理推断的用 INFERRED；素材模糊或矛盾的用 AMBIGUOUS；无依据的用 UNVERIFIED。
遵守字段预算：entity.content ≤ 100 字符，event.content ≤ 100 字符，epoch.description ≤ 100 字符。`;

function catalogLines(catalog: {
  epochs: { uid: string; name: string }[];
  entities: { uid: string; name: string; kind: string }[];
  events: { uid: string; title: string }[];
}): string {
  const lines: string[] = [];
  if (catalog.epochs.length) {
    lines.push(`现有纪元: ${catalog.epochs.map((e) => e.name).join('、')}`);
  }
  if (catalog.entities.length) {
    lines.push(
      `现有条目: ${catalog.entities
        .slice(0, 80)
        .map((e) => `${e.name}(${e.kind})`)
        .join('、')}`
    );
  }
  if (catalog.events.length) {
    lines.push(
      `现有事件: ${catalog.events
        .slice(0, 60)
        .map((e) => e.title)
        .join('、')}`
    );
  }
  return lines.length ? lines.join('\n') : '（空世界：尚无纪元、条目或事件）';
}

export interface CompileInputContext {
  worldName: string;
  premise: string;
  style: string;
  catalog: Parameters<typeof catalogLines>[0];
  sourceFilename: string;
  sourceContent: string;
}

/** Step 1 (analysis): ground the source against the existing world. */
export function buildAnalysisMessages(input: CompileInputContext): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_COMPILER },
    {
      role: 'user',
      content: [
        `【世界】${input.worldName}`,
        `【前提】${input.premise || '（未设定）'}`,
        `【风格】${input.style || '（未设定）'}`,
        catalogLines(input.catalog),
        `【新素材】${input.sourceFilename}`,
        '<<<',
        input.sourceContent.slice(0, 20_000),
        '>>>',
        '',
        '任务：分析这份素材。输出 JSON：{"world_facts": string[]（素材确立的事实，含时间线与人物关系变化）, "contradictions": string[]（与现有世界的矛盾）, "entity_threads": string[]（值得立条的实体线索）, "event_threads": string[]（值得入史的事件线索，按时间排序）, "open_questions": string[]（素材未回答的问题）}'
      ].join('\n')
    }
  ];
}

/** Step 2 (generation): compile the world JSON, grounded in the analysis. */
export function buildGenerationMessages(
  input: CompileInputContext,
  analysisJson: unknown
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_COMPILER },
    {
      role: 'user',
      content: [
        `【世界】${input.worldName}`,
        `【前提】${input.premise || '（未设定）'}`,
        `【风格】${input.style || '（未设定）'}`,
        catalogLines(input.catalog),
        '【素材分析】',
        JSON.stringify(analysisJson).slice(0, 12_000),
        '【素材原文】',
        input.sourceContent.slice(0, 20_000),
        '>>>',
        '',
        '任务：把素材编译为世界增量。输出 JSON（字段全部必填，引用用名称）：',
        '{"epochs":[{"name","order","description"}],',
        ' "entities":[{"kind":"character|location|organization|species|item|concept|rule|faction","name","aliases":[],"summary","content","confidence","tags":[]}],',
        ' "events":[{"title","summary","content","epochName","year","participants":[名称],"location":名称或null,"causes":[事件标题],"confidence"}],',
        ' "relations":[{"subject":名称,"object":名称,"relation":"盟友|敌对|亲族|师徒|从属|居于（或直接用中文自定义如"义兄妹""宿敌"）","polarity":"establish|strengthen|weaken|terminate","eventName":事件标题或null}]}',
        '要求：已存在的纪元/条目不要重复立条，需要补充信息时用同名输出（将作为更新合并）。事件必须给出 epochName 与 year。'
      ].join('\n')
    }
  ];
}

/** Genesis step 1 (plan): framework preview from a seed premise. */
export function buildPlanMessages(input: {
  name: string;
  premise: string;
  style: string;
}): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_COMPILER },
    {
      role: 'user',
      content: [
        `【世界名】${input.name}`,
        `【前提】${input.premise}`,
        `【风格】${input.style || '（未设定）'}`,
        '',
        '任务：为一部作品搭建世界框架（只做规划，不写完整条目）。输出 JSON：',
        '{"premiseExpanded":"扩写后的世界观前提（300字内）","tone":"基调","epochs":[{"name","description"}],"factions":[{"name","summary"}],"regions":[{"name","summary"}],"threads":["值得长期发展的叙事线"]}'
      ].join('\n')
    }
  ];
}

/** Genesis step 2 (commit): full world JSON from the approved plan. */
export function buildGenesisCommitMessages(
  input: { name: string; premise: string; style: string },
  plan: unknown
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_COMPILER },
    {
      role: 'user',
      content: [
        `【世界名】${input.name}`,
        `【前提】${input.premise}`,
        `【风格】${input.style || '（未设定）'}`,
        '【已批准的世界框架】',
        JSON.stringify(plan).slice(0, 12_000),
        '',
        '任务：依据框架生成世界的初始增量。输出 JSON（字段全部必填，引用用名称）：',
        '{"epochs":[{"name","order","description"}],',
        ' "entities":[{"kind":"character|location|organization|species|item|concept|rule|faction","name","aliases":[],"summary","content","confidence","tags":[]}],',
        ' "events":[{"title","summary","content","epochName","year","participants":[],"location":null,"causes":[],"confidence"}],',
        ' "relations":[{"subject","object","relation","polarity","eventName":null}]}',
        '要求：epochs 按框架；entities 覆盖框架中的势力与地域，并补充 4~10 个核心角色；events 为每个纪元生成 2~4 个开篇事件并建立因果；relations 连接核心角色/势力。',
        '【输出预算——必须严格遵守，超出会被截断导致全部作废】：entities ≤ 5 个、events ≤ 8 个、relations ≤ 10 条；每个 entity/event 的 content ≤ 300 字符（宁短勿长）；summary ≤ 80 字。总量必须在一屏内完整输出，宁缺勿滥。'
      ].join('\n')
    }
  ];
}
