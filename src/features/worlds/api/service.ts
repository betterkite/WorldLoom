import type {
  ChangeRow,
  DetailedChangeRow,
  EntityRow,
  EpochRow,
  EventRow,
  VersionRow,
  WorldDetail,
  WorldSummary
} from './types';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return body as T;
}

async function getVersionedJson<T extends { version: number }>(url: string, version?: number) {
  const body = await getJson<T>(url);
  if (version !== undefined && body.version !== version) {
    throw new Error('返回的世界版本与所选版本不一致，请刷新后重试。');
  }
  return body;
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

// ---------- worlds ----------

export const fetchWorlds = async () => {
  const data = await getJson<{ worlds?: unknown }>('/api/worlds');
  if (
    !Array.isArray(data?.worlds) ||
    data.worlds.some(
      (world) => !world || typeof world.id !== 'string' || typeof world.name !== 'string'
    )
  ) {
    throw new Error('世界列表响应格式无效');
  }
  return data as { worlds: WorldSummary[] };
};
export const fetchWorld = (worldId: string) =>
  getJson<{ world: WorldDetail }>(`/api/worlds/${worldId}`);
export const createWorld = (input: {
  name: string;
  premise?: string;
  style?: string;
  ingestMode?: string;
}) => sendJson<{ world: WorldSummary }>('/api/worlds', 'POST', input);
export const deleteWorld = (worldId: string) =>
  sendJson<{ deleted: boolean }>(`/api/worlds/${worldId}`, 'DELETE');

// ---------- entities ----------

export const fetchEntities = (worldId: string) =>
  getJson<{ entities: EntityRow[] }>(`/api/worlds/${worldId}/entities`);
export const submitEntityChange = (
  worldId: string,
  input: { targetUid?: string; payload: Record<string, unknown>; author?: string }
) => sendJson<{ change: ChangeRow }>(`/api/worlds/${worldId}/entities`, 'POST', input);
export const deleteEntityChange = (worldId: string, uid: string) =>
  sendJson<{ change: ChangeRow }>(`/api/worlds/${worldId}/entities`, 'POST', {
    kind: 'entity_delete',
    targetUid: uid
  });

// ---------- events ----------

export const fetchEvents = (worldId: string) =>
  getJson<{ events: EventRow[] }>(`/api/worlds/${worldId}/events`);
export const fetchEpochs = (worldId: string) =>
  getJson<{ epochs: EpochRow[] }>(`/api/worlds/${worldId}/epochs`);
export const submitEventChange = (
  worldId: string,
  input: { payload: Record<string, unknown>; author?: string }
) => sendJson<{ change: ChangeRow }>(`/api/worlds/${worldId}/events`, 'POST', input);

// ---------- sources ----------

export type SourceRow = {
  id: string;
  uid: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  author: string;
  createdAt: string;
};

export const fetchSources = (worldId: string) =>
  getJson<{ sources: SourceRow[] }>(`/api/worlds/${worldId}/sources`);
export const createSource = (
  worldId: string,
  input: { filename?: string; content: string; author?: string; force?: boolean }
) => sendJson<{ skipped: boolean }>(`/api/worlds/${worldId}/sources`, 'POST', input);
export const compileSource = (worldId: string, sourceId: string) =>
  sendJson<{
    runId: string;
    status: string;
    totalChunks: number;
    reused: boolean;
  }>(`/api/worlds/${worldId}/sources/${sourceId}/compile`, 'POST');

export type CompileRunRow = {
  id: string;
  worldId: string;
  kind: 'source' | 'chapter';
  sourceId: string | null;
  chapterId: string | null;
  sourceFilename: string;
  promptVersion: string;
  profileId: string | null;
  model: string | null;
  baseVersion: number;
  totalChunks: number;
  completedChunks: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  batchId: string | null;
  result: unknown;
  error: string | null;
  attempts: number;
  lastHeartbeatAt: string | null;
  usage: {
    expectedCalls: number;
    observedCalls: number;
    usageCalls: number;
    usageCoverage: number;
    usageComplete: boolean;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    latencyMs: number | null;
    latencySamples: number;
    pricingConfigured: boolean;
    estimatedCostUsd: number | null;
    limits: {
      maxInputTokensPerRun: number | null;
      maxOutputTokensPerRun: number | null;
      maxEstimatedCostUsdPerRun: number | null;
    } | null;
  };
  chunks: {
    index: number;
    sourceStart: number;
    sourceEnd: number;
    contentHash: string;
    status: string;
    attempts: number;
    analysisMeta: unknown;
    generationMeta: unknown;
    error: string | null;
  }[];
};

export const fetchCompileRun = (worldId: string, runId: string) =>
  getJson<{ run: CompileRunRow }>(`/api/worlds/${worldId}/compile-runs/${runId}`);

// ---------- genesis ----------

export interface GenesisPlan {
  premiseExpanded: string;
  tone: string;
  epochs: { name: string; description: string }[];
  factions: { name: string; summary: string }[];
  regions: { name: string; summary: string }[];
  threads: string[];
}

export const planGenesis = (worldId: string, input: { premise: string; style?: string }) =>
  sendJson<{ plan: GenesisPlan }>(`/api/worlds/${worldId}/genesis/plan`, 'POST', input);
export const commitGenesis = (
  worldId: string,
  input: { premise: string; style?: string; plan: GenesisPlan }
) =>
  sendJson<{
    staged: number;
    defects: { kind: string; name: string; reason: string }[];
    batchId: string;
  }>(`/api/worlds/${worldId}/genesis/commit`, 'POST', input);

// ---------- timeline (Phase 3) ----------

export type TimelineEvent = {
  uid: string;
  title: string;
  summary: string;
  epochUid: string | null;
  epochName: string;
  year: number | null;
  month: number | null;
  day: number | null;
  dateLabel: string;
  sortOrder: number;
  chronologyPosition: number;
  participantUids: string[];
  participantNames: string[];
  confidence: string;
  causes: string[];
  effects: string[];
};

export type TimelineSegment = {
  epochUid: string | null;
  epochName: string;
  order: number;
  minYear: number | null;
  maxYear: number | null;
  events: TimelineEvent[];
};

export type TimelineResult = {
  version: number;
  segments: TimelineSegment[];
  edges: { causeUid: string; effectUid: string }[];
  entityIndex: { uid: string; name: string; kind: string }[];
};

export const fetchTimeline = (worldId: string, participant?: string | null, version?: number) => {
  const params = new URLSearchParams();
  if (participant) params.set('participant', participant);
  if (version !== undefined) params.set('version', String(version));
  const query = params.toString();
  return getVersionedJson<TimelineResult>(
    `/api/worlds/${worldId}/timeline${query ? `?${query}` : ''}`,
    version
  );
};

export type RelationEdge = {
  subjectUid: string;
  objectUid: string;
  subjectName: string;
  objectName: string;
  relation: string;
  polarity: string;
  active: boolean | null;
  ambiguous: boolean;
  sourceEventUids: (string | null)[];
  sourceRelationUids: string[];
  lastEventUid: string | null;
  lastSortOrder: number;
};

export type RelationsAtResult = {
  version: number;
  ordering: 'fiction-date' | 'legacy-sortOrder';
  warning?: string;
  asOf: { eventUid: string | null; sortOrder: number | null; title: string | null };
  edges: RelationEdge[];
  counts: {
    active: number;
    weakened: number;
    terminated: number;
    foundational: number;
    ambiguous: number;
  };
};

export const fetchRelationsAt = (worldId: string, atEvent?: string | null, version?: number) => {
  const params = new URLSearchParams();
  if (atEvent) params.set('atEvent', atEvent);
  if (version !== undefined) params.set('version', String(version));
  const query = params.toString();
  return getVersionedJson<RelationsAtResult>(
    `/api/worlds/${worldId}/relations${query ? `?${query}` : ''}`,
    version
  );
};

// ---------- lint (Phase 3) ----------

export type LintFinding = {
  id: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  targetUid: string | null;
  relatedUid: string | null;
  message: string;
  status: 'open' | 'ignored' | 'fixed';
  version: number;
};

export type LintQualityBoundary = {
  mode: 'rules';
  semanticReview: 'not_configured';
  evidence: 'master_version';
  automatedWriteback: false;
  heuristicRules: string[];
};

export const runLint = (worldId: string) =>
  sendJson<{
    version: number;
    findings: LintFinding[];
    counts: { error: number; warning: number; fixed: number };
    qualityBoundary: LintQualityBoundary;
  }>(`/api/worlds/${worldId}/lint`, 'POST');
export const fetchLintFindings = (worldId: string) =>
  getJson<{ findings: LintFinding[]; qualityBoundary: LintQualityBoundary }>(
    `/api/worlds/${worldId}/lint`
  );
export const updateLintFinding = (
  worldId: string,
  findingId: string,
  status: 'open' | 'ignored' | 'fixed'
) =>
  sendJson<{ finding: LintFinding }>(`/api/worlds/${worldId}/lint/${findingId}`, 'PATCH', {
    status
  });

// ---------- graph (Phase 4) ----------

export type GraphData = {
  version: number;
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
    active: boolean | null;
    ambiguous: boolean;
    sourceEventUids: (string | null)[];
    sourceRelationUids: string[];
  }[];
  relatedEdges: {
    source: string;
    target: string;
    weight: number;
    signals: Record<string, number>;
  }[];
  communities: { id: number; members: number }[];
};

export const fetchGraph = (worldId: string, version?: number) =>
  getVersionedJson<GraphData>(
    `/api/worlds/${worldId}/graph${version !== undefined ? `?version=${version}` : ''}`,
    version
  );

export type FocusGraphData = {
  view: string;
  version: number;
  asOf?: { eventUid: string | null; title: string | null } | null;
  anchorEvents?: { uid: string; title: string; chronologyPosition: number }[];
  nodes: { uid: string; name: string; kind: string }[];
  edges: {
    id: string;
    source: string;
    target: string;
    label: string;
    polarity: string;
    eventTitle: string | null;
    locationName: string | null;
    stateAt?: 'active' | 'ended' | 'future' | 'uncertain';
    sourceEventUids?: (string | null)[];
    sourceRelationUids?: string[];
  }[];
};

export const fetchFocusGraph = (
  worldId: string,
  view: 'relations' | 'events',
  options: { asOf?: string | null; version?: number } = {}
) => {
  const params = new URLSearchParams({ view });
  if (options.asOf) params.set('asOf', options.asOf);
  if (options.version !== undefined) params.set('version', String(options.version));
  return getVersionedJson<FocusGraphData>(
    `/api/worlds/${worldId}/graph?${params.toString()}`,
    options.version
  );
};

// ---------- review ----------

export const fetchChanges = (worldId: string) =>
  getJson<{ changes: ChangeRow[] }>(`/api/worlds/${worldId}/changes?status=pending`);
export const fetchDetailedChanges = (worldId: string, status: 'pending' | 'merged') =>
  getJson<{ changes: DetailedChangeRow[] }>(
    `/api/worlds/${worldId}/changes?detailed=1&status=${status}`
  );
export const deleteChange = (worldId: string, changeId: string) =>
  sendJson<{ deleted: boolean }>(`/api/worlds/${worldId}/changes/${changeId}`, 'DELETE');
export const mergeWorld = (worldId: string, summary?: string) =>
  sendJson<{ version: number; changeCount: number; conflictCount: number }>(
    `/api/worlds/${worldId}/merge`,
    'POST',
    summary ? { summary } : {}
  );

// ---------- versions ----------

export const fetchVersions = (worldId: string) =>
  getJson<{ versions: VersionRow[]; pending: number }>(`/api/worlds/${worldId}/versions`);
export const rollbackVersion = (worldId: string, version: number) =>
  sendJson<{ version: number }>(`/api/worlds/${worldId}/versions/${version}/rollback`, 'POST', {});
