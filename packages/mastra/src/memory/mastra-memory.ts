import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export async function createHelmrMemory(helmrDataDir: string): Promise<Memory> {
  await mkdir(helmrDataDir, { recursive: true });

  const dbPath = join(helmrDataDir, 'memory.sqlite');

  return new Memory({
    storage: new LibSQLStore({
      id: 'helmr-memory',
      url: `file:${dbPath}`,
    }),
    options: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: {
        enabled: false,
      },
    },
  });
}

export function createInMemoryHelmrMemory(): Memory {
  return new Memory({
    storage: new LibSQLStore({
      id: 'helmr-memory-dev',
      url: 'file::memory:?cache=shared',
    }),
    options: {
      lastMessages: 10,
      semanticRecall: false,
      workingMemory: {
        enabled: false,
      },
    },
  });
}
