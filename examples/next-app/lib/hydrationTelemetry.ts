import { getHydrationDurations } from '@rsc-xray/hydration';

const SNAPSHOT_ENDPOINT = '/api/scx/hydration';
let scheduled = false;

function shouldCollect(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (process.env['NEXT_PUBLIC_SCX_COLLECT_HYDRATION'] === '0') {
    return false;
  }
  return true;
}

function sendDurations(): void {
  const durations = getHydrationDurations();
  if (!durations || Object.keys(durations).length === 0) {
    scheduled = false;
    window.setTimeout(scheduleHydrationSnapshot, 250);
    return;
  }

  try {
    const body = JSON.stringify({ durations });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(SNAPSHOT_ENDPOINT, blob);
      return;
    }
    void fetch(SNAPSHOT_ENDPOINT, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
      },
      keepalive: true,
    });
  } catch (error) {
    console.warn('[scx] Failed to report hydration durations', error);
  } finally {
    scheduled = false;
  }
}

export function scheduleHydrationSnapshot(): void {
  if (!shouldCollect() || scheduled) {
    return;
  }
  scheduled = true;

  const schedule =
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback
      : (cb: () => void) => window.setTimeout(cb, 100);

  schedule(sendDurations);
}
