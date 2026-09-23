import { describe, expect, it } from 'vitest';
import { collapseGraphCommunities, findShortestGraphPath } from '@/lib/graph/view';

const nodes = ['a', 'b', 'c', 'd'].map((id) => ({
  id,
  label: id.toUpperCase(),
  kind: 'character',
  degree: 1
}));

describe('graph exploration helpers', () => {
  it('finds the shortest path without requiring edge direction', () => {
    const path = findShortestGraphPath(
      nodes,
      [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
        { id: 'ad', source: 'a', target: 'd' },
        { id: 'dc', source: 'd', target: 'c' }
      ],
      'c',
      'a'
    );

    expect(path).toEqual({ nodes: ['c', 'b', 'a'], edges: ['bc', 'ab'] });
  });

  it('returns a zero-edge path for the same node and null for disconnected nodes', () => {
    expect(findShortestGraphPath(nodes, [], 'a', 'a')).toEqual({ nodes: ['a'], edges: [] });
    expect(findShortestGraphPath(nodes, [], 'a', 'd')).toBeNull();
  });

  it('collapses nodes by community and removes internal edges', () => {
    const result = collapseGraphCommunities(
      nodes.map((node, index) => ({ ...node, community: index < 2 ? 0 : 1 })),
      [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
        { id: 'cd', source: 'c', target: 'd' }
      ]
    );

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].members).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'community:0',
      target: 'community:1'
    });
  });
});
