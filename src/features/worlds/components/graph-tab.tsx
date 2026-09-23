'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas, type GraphEdge, type GraphNode, type LayoutTypes } from 'reagraph';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { graphQueryOptions } from '../api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { collapseGraphCommunities, findShortestGraphPath } from '@/lib/graph/view';
import Link from 'next/link';

/**
 * 世界图谱（Reagraph 版，Apache-2.0 WebGL 引擎）：
 * - 单画布三视图：关系图（默认）/ 因果图 / 总览
 * - 节点按类型着色定尺寸；边分关系/因果/相关三类（虚线=推断相关）
 * - 点击节点 → 右侧详情侧边栏（摘要、关系、跳转条目页）
 * - 布局可切换：力导向/环形/同心圆/层次/放射/无重叠铺开；WebGL 自动适配画布
 * - 时间切片：按锚点事件折叠关系状态（有效/已终结/尚未发生）
 */

type GraphView = 'relations' | 'events' | 'overview';
type EdgeState = 'active' | 'ended' | 'future';
type EdgeKind = 'relation' | 'causal' | 'related';

type FocusGraph = {
  view: string;
  asOf: { eventUid: string | null; title: string | null } | null;
  anchorEvents?: { uid: string; title: string; sortOrder: number }[];
  nodes: { uid: string; name: string; kind: string }[];
  edges: {
    id: string;
    source: string;
    target: string;
    label: string;
    polarity: string;
    eventTitle: string | null;
    locationName: string | null;
    stateAt?: EdgeState;
  }[];
};

type OverviewGraph = {
  nodes: {
    uid: string;
    name: string;
    kind: string;
    community: number;
    degree: number;
    queryHits: number;
  }[];
  relationEdges: {
    source: string;
    target: string;
    relation: string;
    polarity: string;
    active: boolean;
  }[];
  relatedEdges: { source: string; target: string; weight: number }[];
  communities: { id: number; members: number }[];
};

type EntityDetail = {
  entity: {
    uid: string;
    name: string;
    kind: string;
    summary: string;
    content: string;
    aliases: string[];
    tags: string[];
  };
};

const KIND_META: Record<string, { label: string; color: string }> = {
  character: { label: '人物', color: '#6366f1' },
  faction: { label: '势力', color: '#f59e0b' },
  organization: { label: '组织', color: '#ec4899' },
  species: { label: '族群', color: '#06b6d4' },
  location: { label: '地点', color: '#10b981' },
  item: { label: '物品', color: '#ef4444' },
  concept: { label: '概念', color: '#8b5cf6' },
  rule: { label: '规则', color: '#84cc16' },
  event: { label: '事件', color: '#f97316' },
  community: { label: '社区', color: '#0f766e' }
};
const KIND_FALLBACK = { label: '其它', color: '#94a3b8' };
const kindMeta = (kind: string) => KIND_META[kind] ?? KIND_FALLBACK;

const POLARITY_CN: Record<string, string> = {
  establish: '建立',
  strengthen: '加深',
  weaken: '疏远',
  terminate: '断绝'
};

const EDGE_META: Record<EdgeKind, { label: string; color: string; dashed: boolean }> = {
  relation: { label: '关系', color: '#6366f1', dashed: false },
  causal: { label: '因果', color: '#f59e0b', dashed: false },
  related: { label: '相关（推断）', color: '#94a3b8', dashed: true }
};

const EDGE_STATE_META: Record<EdgeState, { color: string; dashed: boolean; label: string }> = {
  active: { color: '#6366f1', dashed: false, label: '该时刻有效' },
  ended: { color: '#94a3b8', dashed: true, label: '该时刻前已终结' },
  future: { color: '#cbd5e1', dashed: true, label: '该时刻之后才发生' }
};

const VIEW_LABEL: Record<GraphView, string> = {
  relations: '关系图',
  events: '因果图',
  overview: '总览'
};

const LAYOUT_LABEL: Partial<Record<LayoutTypes, string>> = {
  forceDirected2d: '力导向',
  circular2d: '环形',
  concentric2d: '同心圆',
  hierarchicalTd: '层次（上→下）',
  radialOut2d: '放射',
  nooverlap: '无重叠铺开'
};

type ViewEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  stateAt?: EdgeState;
  eventTitle?: string | null;
  locationName?: string | null;
};

type FallbackPoint = { x: number; y: number };

export function GraphTab({ worldId }: { worldId: string }) {
  const [view, setView] = useState<GraphView>('relations');
  const [asOfUid, setAsOfUid] = useState('');
  const [showRelated, setShowRelated] = useState(true);
  const [showIsolated, setShowIsolated] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');
  const [collapseCommunities, setCollapseCommunities] = useState(false);
  const [layoutType, setLayoutType] = useState<LayoutTypes>('forceDirected2d');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [egoUid, setEgoUid] = useState<string | null>(null);
  const [pathStartUid, setPathStartUid] = useState('');
  const [pathTargetUid, setPathTargetUid] = useState('');
  const [canvasReady, setCanvasReady] = useState(false);
  const [webglPaintedKey, setWebglPaintedKey] = useState<string | null>(null);
  const graphViewportRef = useRef<HTMLDivElement>(null);

  const focus = useQuery({
    queryKey: ['focus-graph', worldId, view, asOfUid],
    queryFn: async () => {
      const asOfQuery =
        view === 'relations' && asOfUid ? `&asOf=${encodeURIComponent(asOfUid)}` : '';
      const response = await fetch(`/api/worlds/${worldId}/graph?view=${view}${asOfQuery}`);
      if (!response.ok) throw new Error('图谱加载失败');
      return (await response.json()) as FocusGraph;
    },
    enabled: view !== 'overview'
  });
  const { data: overview } = useSuspenseQuery(graphQueryOptions(worldId));

  const overviewView = overview as unknown as OverviewGraph;

  const detail = useQuery({
    queryKey: ['entity-detail', worldId, selectedUid],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/entities/${selectedUid}`);
      if (!response.ok) throw new Error('条目加载失败');
      return (await response.json()) as EntityDetail;
    },
    enabled: Boolean(selectedUid) && !selectedUid?.startsWith('community:') && view !== 'events'
  });

  // 智能缺省视图（派生而非副作用）：新世界还没有关系事件时关系图为空，
  // 此时直接呈现总览，避免用户打开图谱看到一片空白。
  const relationsEmpty =
    view === 'relations' && focus.isSuccess && (focus.data?.edges.length ?? 0) === 0;
  const effectiveView: GraphView =
    relationsEmpty && overviewView.nodes.length > 0 ? 'overview' : view;

  // ---------- 渲染模型 ----------
  const model = useMemo(() => {
    type Node = {
      id: string;
      label: string;
      kind: string;
      degree: number;
      community?: number;
      members?: { id: string; label: string; kind: string }[];
    };
    const nodes: Node[] = [];
    const edges: ViewEdge[] = [];

    if (effectiveView === 'overview') {
      const degree = new Map<string, number>();
      for (const edge of [...overviewView.relationEdges, ...overviewView.relatedEdges]) {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      }
      for (const node of overviewView.nodes) {
        nodes.push({
          id: node.uid,
          label: node.name,
          kind: node.kind,
          degree: degree.get(node.uid) ?? 0,
          community: node.community
        });
      }
      overviewView.relationEdges.forEach((edge, index) => {
        edges.push({
          id: `rel_${index}`,
          source: edge.source,
          target: edge.target,
          kind: 'relation',
          label: edge.active ? edge.relation : `${edge.relation}·终止`
        });
      });
      if (showRelated) {
        overviewView.relatedEdges.forEach((edge, index) => {
          edges.push({
            id: `sim_${index}`,
            source: edge.source,
            target: edge.target,
            kind: 'related',
            label: ''
          });
        });
      }
    } else {
      const graph = focus.data;
      const degree = new Map<string, number>();
      for (const edge of graph?.edges ?? []) {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      }
      for (const node of graph?.nodes ?? []) {
        nodes.push({
          id: node.uid,
          label: node.name,
          kind: node.kind,
          degree: degree.get(node.uid) ?? 0
        });
      }
      for (const edge of graph?.edges ?? []) {
        edges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind: effectiveView === 'events' ? 'causal' : 'relation',
          label:
            effectiveView === 'events'
              ? edge.label
              : [edge.label, POLARITY_CN[edge.polarity] ?? edge.polarity]
                  .filter(Boolean)
                  .join(' · '),
          stateAt: edge.stateAt,
          eventTitle: edge.eventTitle,
          locationName: edge.locationName
        });
      }
    }

    const filteredNodes =
      kindFilter === 'all' ? nodes : nodes.filter((node) => node.kind === kindFilter);
    let graphNodesForView = filteredNodes;
    let graphEdgesForView = edges.filter(
      (edge) =>
        filteredNodes.some((node) => node.id === edge.source) &&
        filteredNodes.some((node) => node.id === edge.target)
    );

    if (effectiveView === 'overview' && collapseCommunities) {
      const collapsed = collapseGraphCommunities(filteredNodes, graphEdgesForView);
      graphNodesForView = collapsed.nodes;
      graphEdgesForView = collapsed.edges.map((edge) => ({
        ...edge,
        label: `${edge.label || '关联'}（聚类）`
      }));
    }

    const connected = new Set<string>();
    for (const edge of graphEdgesForView) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    const isolated = graphNodesForView.filter((node) => !connected.has(node.id));
    // 当前视图一条边都没有时，孤立节点就是全部内容 —— 照常画出（否则画布全空）
    const effectiveShowIsolated = showIsolated || graphEdgesForView.length === 0;
    const visibleNodes = effectiveShowIsolated
      ? graphNodesForView
      : graphNodesForView.filter((node) => connected.has(node.id));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    let visibleEdges = graphEdgesForView.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );

    if (egoUid) {
      const neighbours = new Set<string>([egoUid]);
      for (const edge of visibleEdges) {
        if (edge.source === egoUid) neighbours.add(edge.target);
        if (edge.target === egoUid) neighbours.add(edge.source);
      }
      visibleEdges = visibleEdges.filter(
        (edge) => neighbours.has(edge.source) && neighbours.has(edge.target)
      );
    }

    // 节点只显示名称：类型已由图例与配色表达，再在名字下方重复「人物/势力/事件」
    // 只会制造噪音（用户反馈）。类型与连接数在右侧详情侧栏里给出。
    const graphNodes: GraphNode[] = visibleNodes.map((node) => ({
      id: node.id,
      label: node.label,
      fill: kindMeta(node.kind).color,
      size: 6 + Math.min(node.degree, 8) * 1.2,
      data: { kind: node.kind, degree: node.degree, community: node.community }
    }));
    const graphEdges: GraphEdge[] = visibleEdges.map((edge) => {
      const state = edge.stateAt ? EDGE_STATE_META[edge.stateAt] : null;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label || undefined,
        fill: state?.color ?? EDGE_META[edge.kind].color,
        dashed: state?.dashed ?? EDGE_META[edge.kind].dashed,
        data: { kind: edge.kind }
      };
    });

    return {
      nodes: visibleNodes,
      edges: visibleEdges,
      graphNodes,
      graphEdges,
      isolated,
      hiddenIsolated: !effectiveShowIsolated
    };
  }, [
    effectiveView,
    focus.data,
    overviewView,
    showRelated,
    showIsolated,
    kindFilter,
    collapseCommunities,
    egoUid
  ]);

  const availableKinds = useMemo(() => {
    const sourceNodes =
      effectiveView === 'overview' ? overviewView.nodes : (focus.data?.nodes ?? []);
    return [...new Set(sourceNodes.map((node) => node.kind))].toSorted();
  }, [effectiveView, focus.data?.nodes, overviewView.nodes]);

  const graphPath = useMemo(
    () => findShortestGraphPath(model.nodes, model.edges, pathStartUid, pathTargetUid),
    [model.edges, model.nodes, pathStartUid, pathTargetUid]
  );
  const pathNodeIds = useMemo(() => new Set(graphPath?.nodes ?? []), [graphPath]);
  const pathEdgeIds = useMemo(() => new Set(graphPath?.edges ?? []), [graphPath]);
  const renderedGraphNodes = useMemo(() => {
    if (!graphPath) return model.graphNodes;
    return model.graphNodes.map((node) => ({
      ...node,
      fill: pathNodeIds.has(node.id) ? '#0f766e' : '#cbd5e1',
      size: pathNodeIds.has(node.id) ? (node.size ?? 6) + 2 : node.size
    }));
  }, [graphPath, model.graphNodes, pathNodeIds]);
  const renderedGraphEdges = useMemo(() => {
    if (!graphPath) return model.graphEdges;
    return model.graphEdges.map((edge) =>
      pathEdgeIds.has(edge.id) ? { ...edge, fill: '#0f766e', dashed: false } : edge
    );
  }, [graphPath, model.graphEdges, pathEdgeIds]);

  // Reagraph creates its R3F camera controls in a separate commit. Mounting the
  // canvas on the same commit as async graph data can leave its internal
  // `isCentered` gate permanently closed in a production build. Give the
  // controls one client frame to mount, and remount when the graph shape or
  // layout changes so the first paint is deterministic.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanvasReady(true));
    return () => cancelAnimationFrame(frame);
  }, [effectiveView, layoutType, renderedGraphNodes.length, renderedGraphEdges.length]);

  const graphRenderKey = `${effectiveView}:${layoutType}:${renderedGraphNodes.map((node) => node.id).join(',')}`;

  const fallbackGraph = useMemo(() => {
    const center = { x: 500, y: 280 };
    const count = renderedGraphNodes.length;
    const radius = count <= 1 ? 0 : Math.min(220, Math.max(130, count * 42));
    const points = new Map<string, FallbackPoint>();
    renderedGraphNodes.forEach((node, index) => {
      const angle = count <= 1 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2;
      points.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    });
    return {
      points,
      edges: renderedGraphEdges.flatMap((edge) => {
        const source = points.get(edge.source);
        const target = points.get(edge.target);
        return source && target ? [{ edge, source, target }] : [];
      })
    };
  }, [renderedGraphEdges, renderedGraphNodes]);

  useEffect(() => {
    if (!canvasReady) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    const checkCanvas = () => {
      if (cancelled) return;
      const canvas = graphViewportRef.current?.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      if (canvas && gl && canvas.width > 1 && canvas.height > 1) {
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let painted = false;
        for (let index = 0; index < pixels.length; index += 4 * 37) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const alpha = pixels[index + 3];
          if (
            alpha > 20 &&
            (Math.abs(red - green) > 12 || Math.abs(green - blue) > 12 || red + green + blue < 690)
          ) {
            painted = true;
            break;
          }
        }
        if (painted) {
          setWebglPaintedKey(graphRenderKey);
          return;
        }
      }
      if (attempts++ < 8) timer = window.setTimeout(checkCanvas, 250);
    };
    checkCanvas();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [canvasReady, graphRenderKey]);

  const selectedNode = model.nodes.find((node) => node.id === selectedUid) ?? null;
  const selectedEdges = model.edges.filter(
    (edge) => edge.source === selectedUid || edge.target === selectedUid
  );
  const nameOf = (uid: string) => model.nodes.find((node) => node.id === uid)?.label ?? uid;
  const presentKinds = availableKinds;
  const slicing = effectiveView === 'relations' && Boolean(focus.data?.asOf);

  const switchView = (next: GraphView) => {
    setView(next);
    setSelectedUid(null);
    setEgoUid(null);
    setAsOfUid('');
  };

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
      <div className='space-y-3'>
        {/* 视图与布局控制 */}
        <div className='flex flex-wrap items-center gap-2'>
          {(Object.keys(VIEW_LABEL) as GraphView[]).map((key) => (
            <Button
              key={key}
              size='sm'
              variant={effectiveView === key ? 'default' : 'outline'}
              onClick={() => switchView(key)}
            >
              {VIEW_LABEL[key]}
            </Button>
          ))}
          <label className='ml-1 flex items-center gap-1 text-xs text-muted-foreground'>
            布局
            <select
              className='h-7 rounded-md border bg-background px-2 text-xs'
              value={layoutType}
              onChange={(event) => setLayoutType(event.target.value as LayoutTypes)}
            >
              {Object.entries(LAYOUT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center gap-1 text-xs text-muted-foreground'>
            类型
            <select
              aria-label='节点类型筛选'
              className='h-7 rounded-md border bg-background px-2 text-xs'
              value={kindFilter}
              onChange={(event) => {
                setKindFilter(event.target.value);
                setSelectedUid(null);
                setPathStartUid('');
                setPathTargetUid('');
              }}
            >
              <option value='all'>全部</option>
              {availableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindMeta(kind).label}
                </option>
              ))}
            </select>
          </label>
          {effectiveView === 'overview' && (
            <label className='flex items-center gap-1 text-xs text-muted-foreground'>
              <input
                type='checkbox'
                checked={collapseCommunities}
                onChange={(event) => {
                  setCollapseCommunities(event.target.checked);
                  setSelectedUid(null);
                  setPathStartUid('');
                  setPathTargetUid('');
                }}
              />
              折叠社区
            </label>
          )}
          {effectiveView === 'relations' && (
            <label className='flex items-center gap-1 text-xs text-muted-foreground'>
              时间切片
              <select
                className='h-7 rounded-md border bg-background px-2 text-xs'
                value={asOfUid}
                onChange={(event) => setAsOfUid(event.target.value)}
              >
                <option value=''>当前</option>
                {(focus.data?.anchorEvents ?? []).map((event) => (
                  <option key={event.uid} value={event.uid}>
                    {event.title || event.uid}
                  </option>
                ))}
              </select>
            </label>
          )}
          {effectiveView === 'overview' && (
            <label className='flex items-center gap-1 text-xs text-muted-foreground'>
              <input
                type='checkbox'
                checked={showRelated}
                onChange={(event) => setShowRelated(event.target.checked)}
              />
              推断相关边
            </label>
          )}
          <label className='flex items-center gap-1 text-xs text-muted-foreground'>
            <input
              type='checkbox'
              checked={showIsolated}
              onChange={(event) => setShowIsolated(event.target.checked)}
            />
            未连接（{model.isolated.length}）
          </label>
          {egoUid && (
            <Button size='sm' variant='outline' onClick={() => setEgoUid(null)}>
              返回全图
            </Button>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs'>
          <span className='font-medium'>路径查找</span>
          <select
            aria-label='路径起点'
            className='h-7 min-w-36 rounded-md border bg-background px-2'
            value={pathStartUid}
            onChange={(event) => setPathStartUid(event.target.value)}
          >
            <option value=''>选择起点</option>
            {model.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
          <span className='text-muted-foreground'>→</span>
          <select
            aria-label='路径终点'
            className='h-7 min-w-36 rounded-md border bg-background px-2'
            value={pathTargetUid}
            onChange={(event) => setPathTargetUid(event.target.value)}
          >
            <option value=''>选择终点</option>
            {model.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
          {(pathStartUid || pathTargetUid) && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                setPathStartUid('');
                setPathTargetUid('');
              }}
            >
              清除
            </Button>
          )}
          {graphPath ? (
            <span className='text-emerald-700 dark:text-emerald-400'>
              已找到 {graphPath.nodes.length - 1} 跳路径：
              {graphPath.nodes.map((uid) => nameOf(uid)).join(' → ')}
            </span>
          ) : pathStartUid && pathTargetUid ? (
            <span className='text-muted-foreground'>当前筛选范围内没有连通路径。</span>
          ) : (
            <span className='text-muted-foreground'>在当前视图和筛选范围内查找最短路径。</span>
          )}
        </div>

        {/* 图例 */}
        <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
          {presentKinds.map((kind) => (
            <span key={kind} className='inline-flex items-center gap-1'>
              <span
                className='inline-block h-2.5 w-2.5 rounded-sm'
                style={{ backgroundColor: kindMeta(kind).color }}
              />
              {kindMeta(kind).label}
            </span>
          ))}
          <span className='mx-1 h-3 w-px bg-border' />
          {(['relation', 'causal'] as EdgeKind[])
            .filter((kind) => model.edges.some((edge) => edge.kind === kind))
            .map((kind) => (
              <span key={kind} className='inline-flex items-center gap-1'>
                <span
                  className='inline-block h-0.5 w-4'
                  style={{ backgroundColor: EDGE_META[kind].color }}
                />
                {EDGE_META[kind].label}
              </span>
            ))}
          {model.edges.some((edge) => edge.kind === 'related') && (
            <span className='inline-flex items-center gap-1'>
              <span className='inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground' />
              {EDGE_META.related.label}
            </span>
          )}
          {slicing &&
            (Object.keys(EDGE_STATE_META) as EdgeState[]).map((state) => (
              <span key={state} className='inline-flex items-center gap-1'>
                <span
                  className='inline-block h-0.5 w-4'
                  style={{
                    backgroundColor: EDGE_STATE_META[state].color,
                    opacity: state === 'future' ? 0.5 : 1
                  }}
                />
                {EDGE_STATE_META[state].label}
              </span>
            ))}
        </div>

        {/* WebGL 画布 */}
        {model.graphNodes.length === 0 ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            {effectiveView === 'events'
              ? '还没有因果边。编译或手工记录事件时建立 cause → effect 关系即可。'
              : effectiveView === 'relations'
                ? '还没有人物关系事件。可用「故事创作」推演采纳或手工提交关系变更。'
                : '先在世界里创建条目，图谱才会生长。'}
          </p>
        ) : !canvasReady ? (
          <div className='flex h-[560px] items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground'>
            正在布局图谱…
          </div>
        ) : (
          // Reagraph 的画布 CSS 为 position:absolute; inset:0 —— 容器必须是定位元素，
          // 否则画布会逃逸到更大的定位祖先、撑破布局并压住下方内容。
          <div
            ref={graphViewportRef}
            data-graph-viewport='true'
            className='relative h-[560px] w-full overflow-hidden rounded-lg border bg-muted/20'
          >
            <GraphCanvas
              // preserveDrawingBuffer 让验收脚本能读取像素，验证图确实铺满画布
              glOptions={{ preserveDrawingBuffer: true }}
              nodes={renderedGraphNodes}
              edges={renderedGraphEdges}
              layoutType={layoutType}
              labelType='auto'
              edgeInterpolation='curved'
              edgeArrowPosition='end'
              draggable
              key={graphRenderKey}
              animated={false}
              actives={selectedUid ? [selectedUid] : []}
              onNodeClick={(node) => {
                setSelectedUid(node.id);
                setEgoUid(null);
              }}
            />
            {webglPaintedKey !== graphRenderKey && (
              <div
                data-graph-fallback='true'
                className='absolute inset-0 bg-background/95'
                aria-label='图谱兼容渲染'
              >
                <svg
                  className='h-full w-full'
                  viewBox='0 0 1000 560'
                  role='img'
                  aria-label='世界关系图谱'
                >
                  <defs>
                    <marker
                      id='worldloom-graph-arrow'
                      markerHeight='7'
                      markerWidth='7'
                      orient='auto-start-reverse'
                      refX='6'
                      refY='3.5'
                      viewBox='0 0 7 7'
                    >
                      <path d='M0,0 L7,3.5 L0,7 z' fill='currentColor' />
                    </marker>
                  </defs>
                  <g className='text-muted-foreground'>
                    {fallbackGraph.edges.map(({ edge, source, target }) => (
                      <line
                        key={edge.id}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={edge.fill ?? '#6366f1'}
                        strokeDasharray={edge.dashed ? '8 6' : undefined}
                        strokeWidth='3'
                        markerEnd='url(#worldloom-graph-arrow)'
                        opacity='0.75'
                      />
                    ))}
                  </g>
                  {renderedGraphNodes.map((node) => {
                    const point = fallbackGraph.points.get(node.id);
                    if (!point) return null;
                    const selected = node.id === selectedUid;
                    return (
                      <g
                        key={node.id}
                        role='button'
                        tabIndex={0}
                        aria-label={`查看${node.label}`}
                        className='cursor-pointer outline-none'
                        onClick={() => {
                          setSelectedUid(node.id);
                          setEgoUid(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedUid(node.id);
                            setEgoUid(null);
                          }
                        }}
                      >
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={selected ? 26 : 21}
                          fill={node.fill ?? '#94a3b8'}
                          stroke={selected ? '#111827' : '#ffffff'}
                          strokeWidth={selected ? 5 : 3}
                        />
                        <text
                          x={point.x}
                          y={point.y + 42}
                          textAnchor='middle'
                          className='fill-foreground text-[18px] font-medium'
                        >
                          {node.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <span className='absolute bottom-3 left-3 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground'>
                  WebGL 不可用，已启用兼容渲染
                </span>
              </div>
            )}
          </div>
        )}

        {model.hiddenIsolated && model.isolated.length > 0 && (
          <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
            <span>未连接节点（{model.isolated.length}）：</span>
            {model.isolated.map((node) => (
              <button
                key={node.id}
                type='button'
                onClick={() => setSelectedUid(node.id)}
                className='rounded-md border px-2 py-0.5 hover:border-primary/40'
              >
                {node.label}
              </button>
            ))}
          </div>
        )}

        {/* 关系视图边清单：点一行即在侧栏查看该关系的主体 */}
        {effectiveView === 'relations' && (focus.data?.edges.length ?? 0) > 0 && (
          <div className='max-h-48 space-y-0.5 overflow-y-auto rounded-lg border p-3 text-xs'>
            {focus.data?.edges.map((edge) => (
              <button
                key={edge.id}
                type='button'
                onClick={() => setSelectedUid(edge.source)}
                className='flex w-full flex-wrap items-center gap-1 py-0.5 text-left hover:text-foreground'
              >
                <strong>{nameOf(edge.source)}</strong>
                <span className='text-muted-foreground'>
                  —{edge.label}
                  {POLARITY_CN[edge.polarity] ? `（${POLARITY_CN[edge.polarity]}）` : ''}→
                </span>
                <strong>{nameOf(edge.target)}</strong>
                {edge.eventTitle && (
                  <Badge variant='outline' className='text-[10px]'>
                    事件：{edge.eventTitle}
                  </Badge>
                )}
                {edge.stateAt && (
                  <Badge
                    variant='outline'
                    className='text-[10px]'
                    style={edge.stateAt !== 'active' ? { opacity: 0.65 } : undefined}
                  >
                    {EDGE_STATE_META[edge.stateAt].label}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        )}

        {relationsEmpty && (
          <p className='text-xs text-muted-foreground'>
            这个世界还没有人物关系事件，已自动切到总览；在「故事创作」推演采纳或手工提交关系变更后，关系图即可使用。
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <Badge variant='outline'>{model.nodes.length} 节点</Badge>
          <Badge variant='outline'>{model.edges.length} 边</Badge>
          {model.isolated.length > 0 && (
            <Badge variant='outline'>未连接 {model.isolated.length}</Badge>
          )}
          {effectiveView === 'overview' && (
            <Badge variant='outline'>{overviewView.communities.length} 社区</Badge>
          )}
          <span className='ml-auto'>点击节点看详情 · 拖拽节点/画布 · 滚轮缩放</span>
        </div>
      </div>

      {/* 节点详情侧边栏 */}
      <aside className='space-y-3 rounded-lg border p-3 text-sm'>
        {!selectedNode ? (
          <p className='py-8 text-center text-xs text-muted-foreground'>
            点击图中任意节点，这里显示它的类型、摘要、关系与出处。
          </p>
        ) : (
          <>
            <div className='flex items-start justify-between gap-2'>
              <div>
                <p className='font-semibold'>{selectedNode.label}</p>
                <p className='text-xs text-muted-foreground'>
                  <span
                    className='mr-1 inline-block h-2 w-2 rounded-sm align-middle'
                    style={{ backgroundColor: kindMeta(selectedNode.kind).color }}
                  />
                  {kindMeta(selectedNode.kind).label} · {selectedNode.degree} 条连接
                </p>
              </div>
              <Button size='sm' variant='ghost' onClick={() => setSelectedUid(null)}>
                关闭
              </Button>
            </div>

            {effectiveView !== 'events' && detail.data?.entity && (
              <>
                {detail.data.entity.summary && (
                  <p className='text-xs leading-relaxed text-muted-foreground'>
                    {detail.data.entity.summary}
                  </p>
                )}
                {detail.data.entity.content && (
                  <p className='max-h-40 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs leading-relaxed'>
                    {detail.data.entity.content}
                  </p>
                )}
                {(detail.data.entity.aliases.length > 0 || detail.data.entity.tags.length > 0) && (
                  <div className='flex flex-wrap gap-1'>
                    {detail.data.entity.aliases.map((alias) => (
                      <Badge key={alias} variant='secondary' className='text-[10px]'>
                        别名：{alias}
                      </Badge>
                    ))}
                    {detail.data.entity.tags.map((tag) => (
                      <Badge key={tag} variant='outline' className='text-[10px]'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            )}

            {selectedNode.kind === 'community' && (
              <div className='space-y-2 rounded-md bg-muted/40 p-2 text-xs'>
                <p className='font-medium'>社区成员（{selectedNode.members?.length ?? 0}）</p>
                <div className='flex max-h-40 flex-wrap gap-1 overflow-y-auto'>
                  {(selectedNode.members ?? []).map((member) => (
                    <button
                      key={member.id}
                      type='button'
                      className='rounded-md border px-2 py-1 hover:border-primary/40'
                      onClick={() => {
                        setCollapseCommunities(false);
                        setSelectedUid(member.id);
                      }}
                    >
                      {member.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className='space-y-1'>
              <p className='text-xs font-medium'>关系（{selectedEdges.length}）</p>
              {selectedEdges.length === 0 && (
                <p className='text-xs text-muted-foreground'>当前视图中没有连接。</p>
              )}
              {selectedEdges.map((edge) => (
                <div
                  key={edge.id}
                  className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'
                >
                  {edge.source === selectedNode.id ? (
                    <>
                      <span>→</span>
                      <button
                        type='button'
                        className='underline-offset-2 hover:underline'
                        onClick={() => setSelectedUid(edge.target)}
                      >
                        {nameOf(edge.target)}
                      </button>
                    </>
                  ) : (
                    <>
                      <span>←</span>
                      <button
                        type='button'
                        className='underline-offset-2 hover:underline'
                        onClick={() => setSelectedUid(edge.source)}
                      >
                        {nameOf(edge.source)}
                      </button>
                    </>
                  )}
                  {edge.label && <span>· {edge.label}</span>}
                  {edge.eventTitle && (
                    <Badge variant='outline' className='text-[10px]'>
                      {edge.eventTitle}
                    </Badge>
                  )}
                  {edge.stateAt && (
                    <Badge variant='outline' className='text-[10px]'>
                      {EDGE_STATE_META[edge.stateAt].label}
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            <div className='flex flex-wrap gap-2'>
              <Button size='sm' variant='outline' onClick={() => setEgoUid(selectedNode.id)}>
                只看它的邻居
              </Button>
              {selectedNode.kind !== 'event' && selectedNode.kind !== 'community' && (
                <Link
                  href={`/dashboard/worlds/${worldId}/entities/${selectedNode.id}`}
                  className='inline-flex h-8 items-center rounded-md border px-3 text-xs hover:border-primary/40'
                >
                  打开条目页
                </Link>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
