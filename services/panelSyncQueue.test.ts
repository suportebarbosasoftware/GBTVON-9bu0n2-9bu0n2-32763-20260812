// Run with: deno test services/panelSyncQueue.test.ts
// @ts-ignore Deno supports explicit .ts imports.
import { createPanelSyncQueue } from './panelSyncQueue.ts';

declare const Deno: { test: (name: string, test: () => Promise<void>) => void };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

Deno.test('polling during an existing read shares a single request', async () => {
  const result = deferred<number>();
  let reads = 0;
  const applied: number[] = [];
  const queue = createPanelSyncQueue({ read: () => { reads += 1; return result.promise; }, apply: value => applied.push(value), onError: () => {} });
  const first = queue.request();
  const second = queue.request();
  await Promise.resolve();
  assert(reads === 1 && first === second, 'Polling created concurrent reads.');
  result.resolve(1); await first;
  assert(applied.join(',') === '1', 'A confirmed read was not published.');
});

Deno.test('login, focus and entry refreshes publish the first snapshot without querying it twice', async () => {
  const result = deferred<number>();
  let reads = 0;
  const applied: number[] = [];
  const queue = createPanelSyncQueue({ read: () => { reads += 1; return result.promise; }, apply: value => applied.push(value), onError: () => {} });
  const login = queue.request(true); await Promise.resolve();
  const focus = queue.request(true); const entry = queue.request(true);
  assert(login === focus && focus === entry, 'Entry refreshes did not share the pending read.');
  result.resolve(1); await login;
  assert(reads === 1 && applied.join(',') === '1', 'The first valid snapshot was discarded or queried twice.');
});

Deno.test('many changes during a read produce one fresh follow-up, never stale state', async () => {
  const old = deferred<number>();
  const fresh = deferred<number>();
  let reads = 0;
  const applied: number[] = [];
  const flags: boolean[] = [];
  const queue = createPanelSyncQueue({ read: urgent => { flags.push(urgent); reads += 1; return reads === 1 ? old.promise : fresh.promise; }, apply: value => applied.push(value), onError: () => {} });
  const done = queue.request(); await Promise.resolve();
  queue.invalidate(); queue.request(true); queue.request(true); queue.request(true);
  old.resolve(1);
  await Promise.resolve(); await Promise.resolve();
  assert(applied.length === 0, 'The pre-mutation snapshot overwrote a confirmed change.');
  fresh.resolve(2); await done;
  assert(reads === 2 && flags[1] === true && applied.join(',') === '2', 'Changes were not coalesced into one fresh read.');
});

Deno.test('disposing a session ignores old responses and cancels queued reads', async () => {
  const old = deferred<number>();
  let reads = 0;
  let applied = false;
  const queue = createPanelSyncQueue({ read: () => { reads += 1; return old.promise; }, apply: () => { applied = true; }, onError: () => {} });
  const done = queue.request(); await Promise.resolve();
  queue.request(true); queue.dispose(); old.resolve(1); await done;
  await queue.request(true);
  assert(reads === 1 && !applied, 'A previous identity repopulated a new panel session.');
});

Deno.test('a refresh arriving as a read settles is not lost', async () => {
  let reads = 0;
  let requestAgain: () => Promise<void> = () => Promise.resolve();
  const applied: number[] = [];
  const queue = createPanelSyncQueue({
    read: async () => { reads += 1; return reads; },
    apply: value => {
      applied.push(value);
      if (value === 1) void Promise.resolve().then(() => requestAgain());
    },
    onError: () => {},
  });
  requestAgain = () => queue.request(true);
  await queue.request();
  assert(reads === 2 && applied.join(',') === '1,2', 'A late refresh required a manual retry.');
});

Deno.test('a failed read can recover on the next automatic cycle without repeating a write', async () => {
  let reads = 0;
  let errors = 0;
  const applied: number[] = [];
  const queue = createPanelSyncQueue({ read: async () => { reads += 1; if (reads === 1) throw new Error('temporary outage'); return 2; }, apply: value => applied.push(value), onError: () => { errors += 1; } });
  await queue.request(); await queue.request();
  assert(errors === 1 && reads === 2 && applied.join(',') === '2', 'A failed request disabled subsequent synchronization.');
});
