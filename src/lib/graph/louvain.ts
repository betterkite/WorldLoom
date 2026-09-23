/**
 * Louvain community detection for the WorldLoom graph.
 * Modularity optimisation over the undirected weighted graph, zero deps.
 * Our graphs are small (≤ a few hundred nodes) so plain local-moving passes
 * are sufficient — no multi-level refinement needed.
 */

export function louvain(
  nodes: { id: string }[],
  edges: { source: string; target: string; weight: number }[]
): { communities: Record<string, number>; communityCount: number } {
  const ids = nodes.map((n) => n.id);
  if (ids.length === 0) return { communities: {}, communityCount: 0 };

  const adjacency = new Map<string, Map<string, number>>();
  for (const id of ids) adjacency.set(id, new Map());
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target) || edge.source === edge.target)
      continue;
    const a = adjacency.get(edge.source) as Map<string, number>;
    const b = adjacency.get(edge.target) as Map<string, number>;
    a.set(edge.target, (a.get(edge.target) ?? 0) + edge.weight);
    b.set(edge.source, (b.get(edge.source) ?? 0) + edge.weight);
  }

  const degree = new Map<string, number>();
  for (const id of ids) {
    degree.set(
      id,
      [...(adjacency.get(id) as Map<string, number>).values()].reduce((sum, w) => sum + w, 0)
    );
  }

  // init: every node in its own community
  const community = new Map<string, string>(ids.map((id) => [id, id]));
  const m2 = 2 * edges.reduce((sum, e) => sum + e.weight, 0) || 1;

  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (const id of ids) {
      const current = community.get(id) as string;
      const neighbours = adjacency.get(id) as Map<string, number>;
      if (neighbours.size === 0) continue;

      // weights to each neighbouring community (excluding self-loops)
      const linksTo = new Map<string, number>();
      for (const [other, weight] of neighbours) {
        if (other === id) continue;
        const otherCommunity = community.get(other) as string;
        linksTo.set(otherCommunity, (linksTo.get(otherCommunity) ?? 0) + weight);
      }

      // community degrees (Σ degree of members) — recomputed cheaply per move
      const communityDegree = new Map<string, number>();
      for (const node of ids) {
        const c = community.get(node) as string;
        communityDegree.set(c, (communityDegree.get(c) ?? 0) + (degree.get(node) ?? 0));
      }
      const currentDegree = communityDegree.get(current) ?? 0;

      let bestCommunity = current;
      let bestGain = 0;
      for (const [targetCommunity, linkWeight] of linksTo) {
        if (targetCommunity === current) continue;
        const gain =
          linkWeight -
          ((degree.get(id) ?? 0) *
            ((communityDegree.get(targetCommunity) ?? 0) -
              (currentDegree - (degree.get(id) ?? 0)))) /
            m2;
        if (gain > bestGain + 1e-9) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }
      if (bestCommunity !== current) {
        community.set(id, bestCommunity);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const remap = new Map<string, number>();
  const communities: Record<string, number> = {};
  for (const id of ids) {
    const raw = community.get(id) as string;
    if (!remap.has(raw)) remap.set(raw, remap.size);
    communities[id] = remap.get(raw) as number;
  }
  return { communities, communityCount: remap.size };
}
