import { NavGroup } from '@/types';

/**
 * 侧边栏导航。`:worldId` 占位符由侧栏按当前浏览的世界动态替换；
 * 不在世界页内时这些条目指向世界总览。
 */
export const navGroups: NavGroup[] = [
  {
    label: '总览',
    items: [
      {
        title: '世界列表',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      }
    ]
  },
  {
    label: '能力中心',
    items: [
      { title: '技能库', url: '/dashboard/skills', icon: 'sparkles', isActive: false, items: [] },
      { title: '评测平台', url: '/dashboard/evals', icon: 'checks', isActive: false, items: [] },
      {
        title: '运行健康',
        url: '/dashboard/worlds/:worldId/ops',
        icon: 'settings',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: '世界工作台',
    items: [
      {
        title: '设定条目',
        url: '/dashboard/worlds/:worldId/entities',
        icon: 'product',
        isActive: false,
        items: []
      },
      {
        title: '时间线',
        url: '/dashboard/worlds/:worldId/timeline',
        icon: 'calendar',
        isActive: false,
        items: []
      },
      {
        title: '故事创作',
        url: '/dashboard/worlds/:worldId/story',
        icon: 'edit',
        isActive: false,
        items: []
      },
      {
        title: '编年史',
        url: '/dashboard/worlds/:worldId/events',
        icon: 'clock',
        isActive: false,
        items: []
      },
      {
        title: '世界知识助手',
        url: '/dashboard/worlds/:worldId/assistant',
        icon: 'chat',
        isActive: false,
        items: []
      },
      {
        title: '图谱',
        url: '/dashboard/worlds/:worldId/graph',
        icon: 'workspace',
        isActive: false,
        items: []
      },
      {
        title: '创世向导',
        url: '/dashboard/worlds/:worldId/genesis',
        icon: 'sparkles',
        isActive: false,
        items: []
      },
      {
        title: '审阅',
        url: '/dashboard/worlds/:worldId/review',
        icon: 'check',
        isActive: false,
        items: []
      },
      {
        title: '一致性检查',
        url: '/dashboard/worlds/:worldId/lint',
        icon: 'settings',
        isActive: false,
        items: []
      },
      {
        title: '版本',
        url: '/dashboard/worlds/:worldId/versions',
        icon: 'clock',
        isActive: false,
        items: []
      }
    ]
  }
];
