export type WorldSummary = {
  id: string;
  name: string;
  premise: string;
  style: string;
  masterVersion: number;
  ingestMode: 'review' | 'auto';
  createdAt: string;
  updatedAt: string;
  pendingChanges: number;
  entityCount: number;
  eventCount: number;
};

export type WorldDetail = WorldSummary & {
  versionCount: number;
  master: { entities: number; events: number; epochs: number };
};

export type EntityRow = {
  id: string;
  uid: string;
  kind: string;
  name: string;
  aliases: string[];
  summary: string;
  confidence: string;
  tags: string[];
  version: number;
};

export type EventRow = {
  id: string;
  uid: string;
  title: string;
  summary: string;
  epochUid: string | null;
  epochYear: number | null;
  sortOrder: number;
  participantUids: string[];
  confidence: string;
  version: number;
};

export type ChangeRow = {
  id: string;
  kind: string;
  targetUid: string | null;
  author: string;
  status: 'pending' | 'merged';
  baseVersion: number;
  revision: number;
  conflict: boolean;
  mergedVersion: number | null;
  createdAt: string;
};

export type VersionRow = {
  id: string;
  version: number;
  parentVersion: number | null;
  summary: string;
  changeCount: number;
  conflictCount: number;
  createdAt: string;
};

export type EpochRow = {
  id: string;
  uid: string;
  name: string;
  order: number;
};
