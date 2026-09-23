'use client';

import { ManuscriptTab } from './manuscript-tab';
import { SourcesTab } from './world-detail';

/**
 * 故事创作（IA 合并）：章节文稿与设定素材同页呈现——两者都是"故事输入"，
 * 走同一套编译流程（定稿/编译 → 审阅链 → 世界条目与事件 → 时间线/编年史/图谱）。
 */
export function StoryStudio({ worldId }: { worldId: string }) {
  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
        流程：<strong>导入或撰写</strong> → <strong>编译</strong>（生成待审变更）→
        <strong>世界工作台 · 审阅</strong>里合并 → 世界条目 / 时间线 / 编年史 / 图谱随之生长。
        只导入不编译，世界不会有任何变化。
      </div>
      <section className='space-y-3'>
        <h2 className='text-sm font-semibold'>作品章节</h2>
        <ManuscriptTab worldId={worldId} />
      </section>
      <section className='space-y-3 border-t pt-4'>
        <h2 className='text-sm font-semibold'>设定素材</h2>
        <SourcesTab worldId={worldId} />
      </section>
    </div>
  );
}
