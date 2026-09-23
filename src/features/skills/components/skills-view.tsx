'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  version: string;
  target: string;
  enabled: boolean;
  builtin: boolean;
};
type SkillRevision = {
  id: string;
  version: string;
  description: string;
  instructions: string;
  retrievalJson: string;
  target: string;
  createdAt: string;
  restoredFromRevisionId?: string | null;
};

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `请求失败：${response.status}`);
  return payload as T;
}

export function SkillsView() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api<{ skills: Skill[] }>('/api/skills', 'GET')
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [skillMd, setSkillMd] = useState('');
  const [form, setForm] = useState({ name: '', description: '', instructions: '', target: 'both' });
  const [historySkillId, setHistorySkillId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['skill-revisions', historySkillId],
    queryFn: () =>
      api<{ skill: Skill; revisions: SkillRevision[] }>(`/api/skills/${historySkillId}`, 'GET'),
    enabled: Boolean(historySkillId)
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['skills'] });

  const create = useMutation({
    mutationFn: () => api<{ skill: Skill }>('/api/skills', 'POST', form),
    onSuccess: () => {
      toast.success('技能已创建');
      setCreateOpen(false);
      setForm({ name: '', description: '', instructions: '', target: 'both' });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const toggle = useMutation({
    mutationFn: (skill: Skill) =>
      api<{ skill: Skill }>(`/api/skills/${skill.id}`, 'PATCH', { enabled: !skill.enabled }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message)
  });
  const importSkill = useMutation({
    mutationFn: () =>
      api<{ created: boolean; skill: Skill }>('/api/skills/import', 'POST', {
        text: skillMd,
        filename: 'SKILL.md'
      }),
    onSuccess: (r) => {
      toast.success(
        `${r.created ? '已导入新技能' : '已更新技能'}：${r.skill.name} v${r.skill.version}`
      );
      setImportOpen(false);
      setSkillMd('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const restore = useMutation({
    mutationFn: ({ skillId, revisionId }: { skillId: string; revisionId: string }) =>
      api<{ skill: Skill; createdRevision: boolean }>(
        `/api/skills/${skillId}/revisions/${revisionId}/activate`,
        'POST'
      ),
    onSuccess: (result, variables) => {
      toast.success(
        result.createdRevision ? `已恢复为新版本 v${result.skill.version}` : '当前内容已是该版本'
      );
      refresh();
      queryClient.invalidateQueries({ queryKey: ['skill-revisions', variables.skillId] });
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const remove = useMutation({
    mutationFn: (skill: Skill) => api<{ deleted: boolean }>(`/api/skills/${skill.id}`, 'DELETE'),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <span className='text-sm text-muted-foreground'>
          技能作用于 世界知识助手（assistant）/ 创世推演（genesis）/ 两者（both）；启用即生效。
        </span>
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' onClick={() => setImportOpen(true)}>
            <Icons.upload className='mr-1 h-4 w-4' /> 导入 SKILL.md
          </Button>
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            <Icons.add className='mr-1 h-4 w-4' /> 新建技能
          </Button>
        </div>
      </div>
      <div className='space-y-2'>
        {data?.skills.map((skill) => (
          <div key={skill.id} className='rounded-lg border text-sm'>
            <div className='flex items-center gap-3 p-3'>
              <Badge variant={skill.builtin ? 'secondary' : 'outline'}>
                {skill.builtin ? '内置' : '自定义'}
              </Badge>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{skill.name}</span>
                  <Badge variant='outline' className='text-xs'>
                    {skill.target}
                  </Badge>
                  <span className='text-xs text-muted-foreground'>v{skill.version}</span>
                  {!skill.enabled && (
                    <Badge variant='destructive' className='text-xs'>
                      已停用
                    </Badge>
                  )}
                </div>
                <div className='truncate text-xs text-muted-foreground'>{skill.description}</div>
              </div>
              <Button
                size='sm'
                variant='outline'
                aria-expanded={historySkillId === skill.id}
                onClick={() => setHistorySkillId(historySkillId === skill.id ? null : skill.id)}
              >
                版本历史
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => toggle.mutate({ ...skill, enabled: !skill.enabled })}
              >
                {skill.enabled ? '停用' : '启用'}
              </Button>
              {!skill.builtin && (
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label={`删除 ${skill.name}`}
                  onClick={() => remove.mutate(skill)}
                >
                  <Icons.trash className='h-4 w-4' />
                </Button>
              )}
            </div>
            {historySkillId === skill.id && (
              <div className='border-t bg-muted/20 px-3 py-2'>
                <div className='mb-2 text-xs font-medium text-muted-foreground'>版本快照</div>
                {history.isPending && <div className='text-xs text-muted-foreground'>读取中…</div>}
                {history.data?.revisions.map((revision) => (
                  <div
                    key={revision.id}
                    className='flex items-start gap-3 border-b py-2 last:border-0'
                  >
                    <Badge variant='outline' className='text-xs'>
                      v{revision.version}
                    </Badge>
                    <div className='min-w-0 flex-1'>
                      <div className='text-xs'>{revision.description}</div>
                      <div className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                        {revision.instructions}
                      </div>
                    </div>
                    <span className='text-[11px] text-muted-foreground'>
                      {new Date(revision.createdAt).toLocaleString('zh-CN')}
                    </span>
                    {history.data?.skill.version === revision.version && (
                      <Badge variant='secondary' className='text-xs'>
                        当前
                      </Badge>
                    )}
                    {!skill.builtin && history.data?.skill.version !== revision.version && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={restore.isPending}
                        onClick={() =>
                          restore.mutate({ skillId: skill.id, revisionId: revision.id })
                        }
                      >
                        恢复此版本
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>导入 SKILL.md</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='skill-file'>选择文件（.md）</Label>
            <Input
              id='skill-file'
              type='file'
              accept='.md,text/markdown'
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setSkillMd(await file.text());
              }}
            />
            <Label htmlFor='skill-md'>
              或粘贴内容（frontmatter 需含 name / description，可选 target / retrieval）
            </Label>
            <Textarea
              id='skill-md'
              rows={8}
              className='max-h-[35vh] overflow-y-auto'
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
              placeholder={
                '---\nname: epic-plotter\ndescription: 史诗式情节推演\ntarget: genesis\nretrieval: {"topK": 12}\n---\n\n以多线交织的方式推演后续。'
              }
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              disabled={skillMd.trim().length < 10 || importSkill.isPending}
              onClick={() => importSkill.mutate()}
            >
              {importSkill.isPending ? '导入中…' : '导入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='skill-name'>名称（小写字母/数字/连字符）</Label>
              <Input
                id='skill-name'
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder='epic-plotter'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='skill-desc'>描述</Label>
              <Input
                id='skill-desc'
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='skill-inst'>指令（注入世界知识助手 / 创世推演）</Label>
              <Textarea
                id='skill-inst'
                rows={5}
                className='max-h-[30vh] overflow-y-auto'
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </div>
            <div className='space-y-2'>
              <Label>作用域</Label>
              <div className='flex gap-2'>
                {['assistant', 'genesis', 'both'].map((t) => (
                  <Button
                    key={t}
                    size='sm'
                    variant={form.target === t ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, target: t })}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!form.name.trim() || !form.instructions.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? '创建中…' : '创建'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
