import { describe, expect, it } from 'vitest';
import { parseDockerStatsSnapshot, parseMemoryValue } from '../scripts/docker-memory.mjs';

describe('Docker memory snapshot parser', () => {
  it('parses binary and decimal Docker memory units', () => {
    expect(parseMemoryValue('1.5GiB')).toBe(1.5 * 1024 ** 3);
    expect(parseMemoryValue('250MB')).toBe(250 * 1_000 ** 2);
    expect(parseMemoryValue('64B')).toBe(64);
  });

  it('parses multiple named Compose containers from one snapshot', () => {
    expect(
      parseDockerStatsSnapshot(
        '14164feacf33\tworldloom-app\t54.68MiB / 3.825GiB\n' +
          '7c9e33febead\tworldloom-db\t64.59MiB / 3.825GiB\n'
      )
    ).toEqual([
      {
        containerId: '14164feacf33',
        name: 'worldloom-app',
        usedBytes: 54.68 * 1024 ** 2,
        limitBytes: 3.825 * 1024 ** 3
      },
      {
        containerId: '7c9e33febead',
        name: 'worldloom-db',
        usedBytes: 64.59 * 1024 ** 2,
        limitBytes: 3.825 * 1024 ** 3
      }
    ]);
  });

  it('rejects unrecognized units and malformed rows instead of inventing values', () => {
    expect(() => parseMemoryValue('3.2widgets')).toThrow('unsupported Docker memory value');
    expect(() => parseDockerStatsSnapshot('worldloom-app 54MiB / 2GiB')).toThrow(
      'invalid Docker stats row'
    );
  });
});
