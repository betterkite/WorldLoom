import { queryOptions } from '@tanstack/react-query';
import {
  fetchChanges,
  fetchLintFindings,
  fetchRelationsAt,
  fetchTimeline,
  fetchGraph,
  fetchSources,
  fetchEntities,
  fetchEpochs,
  fetchEvents,
  fetchVersions,
  fetchWorld,
  fetchWorlds
} from './service';

export const worldKeys = {
  all: ['worlds'] as const,
  list: () => [...worldKeys.all, 'list'] as const,
  detail: (worldId: string) => [...worldKeys.all, 'detail', worldId] as const,
  entities: (worldId: string) => [...worldKeys.all, worldId, 'entities'] as const,
  events: (worldId: string) => [...worldKeys.all, worldId, 'events'] as const,
  epochs: (worldId: string) => [...worldKeys.all, worldId, 'epochs'] as const,
  changes: (worldId: string) => [...worldKeys.all, worldId, 'changes'] as const,
  sources: (worldId: string) => [...worldKeys.all, worldId, 'sources'] as const,
  timeline: (worldId: string) => [...worldKeys.all, worldId, 'timeline'] as const,
  lint: (worldId: string) => [...worldKeys.all, worldId, 'lint'] as const,
  graph: (worldId: string) => [...worldKeys.all, worldId, 'graph'] as const,
  versions: (worldId: string) => [...worldKeys.all, worldId, 'versions'] as const
};

export const worldsQueryOptions = () =>
  queryOptions({ queryKey: worldKeys.list(), queryFn: fetchWorlds });

export const worldQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.detail(worldId), queryFn: () => fetchWorld(worldId) });

export const entitiesQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.entities(worldId), queryFn: () => fetchEntities(worldId) });

export const eventsQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.events(worldId), queryFn: () => fetchEvents(worldId) });

export const epochsQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.epochs(worldId), queryFn: () => fetchEpochs(worldId) });

export const changesQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.changes(worldId), queryFn: () => fetchChanges(worldId) });

export const sourcesQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.sources(worldId), queryFn: () => fetchSources(worldId) });

export const versionsQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.versions(worldId), queryFn: () => fetchVersions(worldId) });

export const timelineQueryOptions = (worldId: string, participant?: string | null) =>
  queryOptions({
    queryKey: [...worldKeys.timeline(worldId), participant ?? 'all'],
    queryFn: () => fetchTimeline(worldId, participant)
  });

export const relationsAtQueryOptions = (worldId: string, atEvent?: string | null) =>
  queryOptions({
    queryKey: [...worldKeys.all, worldId, 'relations', atEvent ?? 'current'],
    queryFn: () => fetchRelationsAt(worldId, atEvent)
  });

export const lintQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.lint(worldId), queryFn: () => fetchLintFindings(worldId) });
export const graphQueryOptions = (worldId: string) =>
  queryOptions({ queryKey: worldKeys.graph(worldId), queryFn: () => fetchGraph(worldId) });
