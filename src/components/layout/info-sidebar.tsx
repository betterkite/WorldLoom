'use client';

import * as React from 'react';
import { Icons } from '@/components/icons';
import Link from 'next/link';
import {
  Infobar,
  InfobarContent,
  InfobarGroup,
  InfobarGroupContent,
  InfobarHeader,
  InfobarRail,
  InfobarTrigger,
  useInfobar
} from '@/components/ui/infobar';

// 无内容时的默认面板：WorldLoom 使用指南
const defaultData: InfobarContent = {
  title: '使用指南',
  sections: [
    {
      title: '快速开始',
      description:
        '① 在「世界列表」新建世界 → ② 用「创世向导」生成骨架，或从「素材」导入半成品文稿后编译 → ③ 到「审阅」把待审变更合并进正史 → ④ 在「故事创作」推演续写，「图谱 / 时间线」检查设定。'
    },
    {
      title: '版本与一致性',
      description:
        '每次合并都会生成不可变版本，可随时回滚；「一致性检查」会报出因果倒置、悬空引用等问题并支持忽略与自愈。'
    }
  ]
};

export function InfoSidebar({ ...props }: React.ComponentProps<typeof Infobar>) {
  const { content } = useInfobar();
  const data = content || defaultData;

  return (
    <Infobar {...props}>
      <InfobarHeader className='bg-sidebar sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold wrap-break-word'>{data.title}</h2>
        </div>
        <div className='shrink-0'>
          <InfobarTrigger />
        </div>
      </InfobarHeader>
      <InfobarContent>
        <InfobarGroup>
          <InfobarGroupContent>
            <div className='flex flex-col gap-6 px-4 py-4'>
              {data.sections && data.sections.length > 0 ? (
                data.sections.map((section) => (
                  <div key={section.title} className='flex flex-col gap-3'>
                    {section.title && (
                      <h3 className='text-foreground text-sm font-semibold'>{section.title}</h3>
                    )}
                    {section.description && (
                      <p className='text-muted-foreground text-sm leading-relaxed'>
                        {section.description}
                      </p>
                    )}
                    {section.links && section.links.length > 0 && (
                      <div className='flex flex-col gap-2'>
                        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                          Learn more
                        </h4>
                        <ul className='flex flex-col gap-1.5'>
                          {section.links.map((link) => (
                            <li key={link.title}>
                              <Link
                                href={link.url}
                                className='text-primary flex items-center gap-1.5 text-sm underline'
                                target='_blank'
                                rel='noopener noreferrer'
                              >
                                <span>{link.title}</span>
                                <Icons.chevronRight className='h-3 w-3' />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className='text-muted-foreground px-2 py-4 text-center text-sm'>
                  No content available
                </div>
              )}
            </div>
          </InfobarGroupContent>
        </InfobarGroup>
      </InfobarContent>
      <InfobarRail />
    </Infobar>
  );
}
