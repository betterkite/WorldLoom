import { tokenize } from '@/lib/retrieval/tokenizer';

/**
 * Weighted relation edges derived from the current WorldLoom graph model.
 * 5 signals: direct link ×3, source overlap ×4, Adamic-Adar ×1.5,
 * type affinity ×1, lexical overlap ×1.5 — no LLM required.
 *
 * In the world model:
 *  - "direct link" = causal edges (event→event) + relationship co-anchoring
 *  - "source overlap" = shared sourceRefs / shared participants
 *  - lexical overlap = bigram-set Jaccard over summaries (distinctive terms only)
 */

export interface GraphNodeInput {
  uid: string;
  kind: string;
  name: string;
  summary: string;
  tags: string[];
  participantUids?: string[];
  sourceRefs?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  signals: Record<string, number>;
}

const DIRECT = 3.0;
const SHARED = 4.0;
const ADAMIC = 1.5;
const TYPE_AFFINITY = 1.0;
const LEXICAL = 1.5;
const MAX_PAIRWISE = 400;
const MIN_SHARED_BIGRAMS = 8;
const MIN_JACCARD = 0.12;
const MAX_DF_RATIO = 0.5;

function relationPairKey(a: string, b: string) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function computeRelatedEdges(
  nodes: GraphNodeInput[],
  causalPairs: [string, string][]
): GraphEdge[] {
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const scores = new Map<string, { weight: number; signals: Record<string, number> }>();
  const bump = (a: string, b: string, amount: number, signal: string) => {
    if (a === b || !byUid.has(a) || !byUid.has(b)) return;
    const k = relationPairKey(a, b);
    const entry = scores.get(k) ?? {
      weight: 0,
      signals: {
        direct_link: 0,
        shared_context: 0,
        adamic_adar: 0,
        type_affinity: 0,
        lexical_overlap: 0
      }
    };
    entry.weight += amount;
    entry.signals[signal] += amount;
    scores.set(k, entry);
  };

  // 1. causal links
  for (const [a, b] of causalPairs) bump(a, b, DIRECT, 'direct_link');

  // 2. shared context (participants of the same events / same sources)
  const contextGroups = new Map<string, string[]>();
  for (const node of nodes) {
    for (const participant of node.participantUids ?? []) {
      const groupKey = `p:${participant}`;
      contextGroups.set(groupKey, [...(contextGroups.get(groupKey) ?? []), node.uid]);
    }
    for (const source of node.sourceRefs ?? []) {
      const groupKey = `s:${source}`;
      contextGroups.set(groupKey, [...(contextGroups.get(groupKey) ?? []), node.uid]);
    }
  }
  for (const members of contextGroups.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        bump(members[i], members[j], SHARED, 'shared_context');
      }
    }
  }

  // 3. Adamic-Adar over causal neighborhoods
  if (nodes.length <= 800) {
    const neighbors = new Map(nodes.map((n) => [n.uid, new Set<string>()]));
    for (const [a, b] of causalPairs) {
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
    }
    const seen = new Set<string>();
    for (const [, neighborhood] of neighbors) {
      const list = [...neighborhood];
      if (list.length < 2) continue;
      const contribution = 1 / Math.log(list.length + 2);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const [a, b] = list[i] < list[j] ? [list[i], list[j]] : [list[j], list[i]];
          if (a === b) continue;
          const k = relationPairKey(a, b);
          if (seen.has(k) || scores.get(k)?.signals.direct_link) continue;
          seen.add(k);
          bump(a, b, ADAMIC * contribution, 'adamic_adar');
        }
      }
    }
  }

  // 4. type affinity for pairs already related
  const typeGroups = new Map<string, string[]>();
  for (const node of nodes)
    typeGroups.set(node.kind, [...(typeGroups.get(node.kind) ?? []), node.uid]);
  for (const members of typeGroups.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const k = relationPairKey(members[i], members[j]);
        if (scores.has(k)) bump(members[i], members[j], TYPE_AFFINITY, 'type_affinity');
      }
    }
  }

  // 5. lexical overlap over distinctive bigrams
  const contentNodes = nodes.filter((n) => n.summary.length > 0 && n.summary.length <= 4000);
  if (contentNodes.length >= 2 && contentNodes.length <= MAX_PAIRWISE) {
    const tokenSets = new Map<string, Set<string>>(
      contentNodes.map((n) => [n.uid, new Set(tokenize(`${n.name} ${n.summary}`))])
    );
    const documentFrequency = new Map<string, number>();
    for (const set of tokenSets.values()) {
      for (const term of set) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    const maxDf = Math.max(1, Math.floor(contentNodes.length * MAX_DF_RATIO));
    for (let i = 0; i < contentNodes.length; i += 1) {
      const left = [...tokenSets.get(contentNodes[i].uid)!].filter(
        (t) => (documentFrequency.get(t) ?? 0) <= maxDf
      );
      for (let j = i + 1; j < contentNodes.length; j += 1) {
        const right = new Set(tokenSets.get(contentNodes[j].uid) ?? []);
        let shared = 0;
        for (const term of left) if (right.has(term)) shared += 1;
        if (shared < MIN_SHARED_BIGRAMS) continue;
        const union = left.length + right.size - shared;
        if (union <= 0 || shared / union < MIN_JACCARD) continue;
        bump(contentNodes[i].uid, contentNodes[j].uid, LEXICAL, 'lexical_overlap');
      }
    }
  }

  return [...scores.entries()].map(([k, entry]) => {
    const [a, b] = k.split('\u0000');
    return {
      source: a,
      target: b,
      weight: Number(entry.weight.toFixed(3)),
      signals: Object.fromEntries(
        Object.entries(entry.signals).map(([name, value]) => [name, Number(value.toFixed(3))])
      )
    };
  });
}
