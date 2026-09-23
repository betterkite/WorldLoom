import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import type { GenesisPlan } from './service';
import {
  compileSource,
  createSource,
  createWorld,
  commitGenesis,
  planGenesis,
  runLint,
  updateLintFinding,
  deleteChange,
  deleteEntityChange,
  deleteWorld,
  mergeWorld,
  rollbackVersion,
  submitEntityChange,
  submitEventChange
} from './service';
import { worldKeys } from './queries';

const invalidateWorld = (worldId: string) => {
  const client = getQueryClient();
  void client.invalidateQueries({ queryKey: worldKeys.detail(worldId) });
  void client.invalidateQueries({ queryKey: worldKeys.entities(worldId) });
  void client.invalidateQueries({ queryKey: worldKeys.events(worldId) });
  void client.invalidateQueries({ queryKey: worldKeys.epochs(worldId) });
  void client.invalidateQueries({ queryKey: worldKeys.changes(worldId) });
  void client.invalidateQueries({ queryKey: worldKeys.versions(worldId) });
};

export const createWorldMutation = mutationOptions({
  mutationFn: createWorld,
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: worldKeys.list() });
  }
});

export const deleteWorldMutation = mutationOptions({
  mutationFn: deleteWorld,
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: worldKeys.list() });
  }
});

export const submitEntityChangeMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { targetUid?: string; payload: Record<string, unknown> }) =>
      submitEntityChange(worldId, input),
    onSettled: () => invalidateWorld(worldId)
  });

export const deleteEntityChangeMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (uid: string) => deleteEntityChange(worldId, uid),
    onSettled: () => invalidateWorld(worldId)
  });

export const submitEventChangeMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { payload: Record<string, unknown> }) => submitEventChange(worldId, input),
    onSettled: () => invalidateWorld(worldId)
  });

export const deleteChangeMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (changeId: string) => deleteChange(worldId, changeId),
    onSettled: () => invalidateWorld(worldId)
  });

export const mergeWorldMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (summary?: string) => mergeWorld(worldId, summary),
    // 注意：组件常以 {...mergeWorldMutation(worldId), onSuccess: toast} 覆盖回调，
    // 因此集中失效必须挂在 onSettled（不会被覆盖）——否则列表在合并后保持陈旧。
    onSettled: () => {
      invalidateWorld(worldId);
      getQueryClient().invalidateQueries({ queryKey: worldKeys.list() });
    }
  });

export const rollbackVersionMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (version: number) => rollbackVersion(worldId, version),
    onSettled: () => {
      invalidateWorld(worldId);
      getQueryClient().invalidateQueries({ queryKey: worldKeys.list() });
    }
  });

const invalidateSources = (worldId: string) => {
  getQueryClient().invalidateQueries({ queryKey: worldKeys.sources(worldId) });
};

export const createSourceMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { filename?: string; url?: string; content: string; force?: boolean }) =>
      createSource(worldId, input),
    onSuccess: () => invalidateSources(worldId)
  });

export const compileSourceMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (sourceId: string) => compileSource(worldId, sourceId),
    onSuccess: () => {
      invalidateWorld(worldId);
      invalidateSources(worldId);
    }
  });

export const planGenesisMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { premise: string; style?: string }) => planGenesis(worldId, input),
    onSuccess: () => undefined
  });

export const commitGenesisMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { premise: string; style?: string; plan: GenesisPlan }) =>
      commitGenesis(worldId, input),
    onSuccess: () => {
      invalidateWorld(worldId);
      invalidateSources(worldId);
    }
  });

export const runLintMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: () => runLint(worldId),
    onSuccess: () => {
      getQueryClient().invalidateQueries({ queryKey: worldKeys.lint(worldId) });
    }
  });

export const updateLintFindingMutation = (worldId: string) =>
  mutationOptions({
    mutationFn: (input: { findingId: string; status: 'open' | 'ignored' | 'fixed' }) =>
      updateLintFinding(worldId, input.findingId, input.status),
    onSuccess: () => {
      getQueryClient().invalidateQueries({ queryKey: worldKeys.lint(worldId) });
    }
  });
