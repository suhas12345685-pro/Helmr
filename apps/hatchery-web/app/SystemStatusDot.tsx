'use client';

import { useEffect, useState } from 'react';
import { fetchSystemStatus } from '@/lib/api';

export function SystemStatusDot() {
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const status = await fetchSystemStatus();
        if (!cancelled) setHealthy(status.healthy);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    }

    check();
    const interval = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (healthy === null) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        <span className="text-xs text-gray-500">Connecting...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          healthy ? 'bg-green-400' : 'bg-red-400'
        }`}
      />
      <span className={`text-xs ${healthy ? 'text-green-400' : 'text-red-400'}`}>
        {healthy ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}
