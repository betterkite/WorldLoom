export type GraphViewNode = {
  id: string;
  label: string;
  kind: string;
  degree: number;
  community?: number;
  members?: { id: string; label: string; kind: string }[];
};

export type GraphViewEdge = {
  id: string;
  source: string;
  target: string;
};

export type GraphPath = {
  nodes: string[];
  edges: string[];
};

/** Collapse overview nodes into community nodes while preserving cross-community edges. */
export function collapseGraphCommunities<TNode extends GraphViewNode, TEdge extends GraphViewEdge>(
  nodes: TNode[],
  edges: TEdge[]
): { nodes: GraphViewNode[]; edges: TEdge[] } {
  const groups = new Map<string, TNode[]>();
  for (const node of nodes) {
    const groupId = `community:${node.community ?? node.id}`;
    const group = groups.get(groupId) ?? [];
    group.push(node);
    groups.set(groupId, group);
  }

  const nodeToGroup = new Map<string, string>();
  const collapsedNodes = [...groups.entries()].map(([groupId, members]) => {
    for (const member of members) nodeToGroup.set(member.id, groupId);
    const community = members[0]?.community ?? 0;
    return {
      id: groupId,
      label: `社区 ${community + 1} · ${members.length} 项`,
      kind: 'community',
      community,
      degree: members.reduce((total, member) => total + member.degree, 0),
      members: members.map((member) => ({
        id: member.id,
        label: member.label,
        kind: member.kind
      }))
    };
  });

  const collapsedEdges = new Map<string, TEdge>();
  for (const edge of edges) {
    const source = nodeToGroup.get(edge.source);
    const target = nodeToGroup.get(edge.target);
    if (!source || !target || source === target) continue;
    const edgeKey = `${[source, target].toSorted().join('|')}`;
    if (!collapsedEdges.has(edgeKey)) {
      collapsedEdges.set(edgeKey, {
        ...edge,
        id: `collapsed:${edgeKey}`,
        source,
        target
      });
    }
  }

  return { nodes: collapsedNodes, edges: [...collapsedEdges.values()] };
}

/**
 * Find the shortest undirected path through the currently visible graph.
 * Relationships can be directed in storage, but graph exploration should
 * still let a user discover how two entities are connected in either
 * direction.
 */
export function findShortestGraphPath(
  nodes: GraphViewNode[],
  edges: GraphViewEdge[],
  start: string,
  target: string
): GraphPath | null {
  if (
    !start ||
    !target ||
    !nodes.some((node) => node.id === start) ||
    !nodes.some((node) => node.id === target)
  ) {
    return null;
  }
  if (start === target) return { nodes: [start], edges: [] };

  const adjacency = new Map<string, { node: string; edge: string }[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push({ node: edge.target, edge: edge.id });
    adjacency.get(edge.target)?.push({ node: edge.source, edge: edge.id });
  }

  const queue = [start];
  const parent = new Map<string, { node: string; edge: string } | null>([[start, null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of adjacency.get(current) ?? []) {
      if (parent.has(next.node)) continue;
      parent.set(next.node, { node: current, edge: next.edge });
      if (next.node === target) {
        const pathNodes = [target];
        const pathEdges: string[] = [];
        let cursor = target;
        while (cursor !== start) {
          const previous = parent.get(cursor);
          if (!previous) return null;
          pathEdges.push(previous.edge);
          cursor = previous.node;
          pathNodes.push(cursor);
        }
        return { nodes: pathNodes.toReversed(), edges: pathEdges.toReversed() };
      }
      queue.push(next.node);
    }
  }

  return null;
}
