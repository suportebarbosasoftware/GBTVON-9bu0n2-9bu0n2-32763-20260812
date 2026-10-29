// Pure service tests. Run with: deno test services/panelRequestGate.test.ts
// @ts-ignore Deno tests require explicit TypeScript extensions; Expo does not enable that compiler option.
import { createPanelRequestGate } from './panelRequestGate.ts';

declare const Deno: { test: (name: string, test: () => Promise<void>) => void };
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

Deno.test('writes do not wait for an existing slow read', async () => {
  const gate = createPanelRequestGate();
  const slow = deferred();
  const read = gate.runRead(() => slow.promise);
  let wrote = false;
  await gate.runWrite(async () => { wrote = true; });
  assert(wrote, 'A write was blocked by an existing read.');
  slow.release();
  await read;
});

Deno.test('new reads wait for all current writes and are then released', async () => {
  const gate = createPanelRequestGate();
  const first = deferred();
  const second = deferred();
  const writeA = gate.runWrite(() => first.promise);
  const writeB = gate.runWrite(() => second.promise);
  let reads = 0;
  const read = gate.runRead(async () => { reads += 1; });
  first.release();
  await writeA;
  assert(reads === 0, 'A background read started while a write was still pending.');
  second.release();
  await Promise.all([writeB, read]);
  assert(Number(reads) === 1, 'The read did not execute exactly once.');
});

Deno.test('a previous representative action never blocks reads for a different panel identity', async () => {
  const gate = createPanelRequestGate();
  const slow = deferred();
  const write = gate.runWrite(() => slow.promise, 'rep-a');
  let ownRead = false;
  const waitingRead = gate.runRead(async () => { ownRead = true; }, 'rep-a');
  let otherRead = false;
  await gate.runRead(async () => { otherRead = true; }, 'root');
  assert(otherRead && !ownRead, 'An unrelated panel waited behind the slow representative action.');
  slow.release(); await Promise.all([write, waitingRead]);
  assert(ownRead, 'The matching session did not recover after confirmation.');
});

Deno.test('a failed write releases waiting reads without retrying the write', async () => {
  const gate = createPanelRequestGate();
  const waiting = deferred();
  let writes = 0;
  const write = gate.runWrite(async () => { writes += 1; await waiting.promise; throw new Error('test failure'); });
  let readFinished = false;
  const read = gate.runRead(async () => { readFinished = true; });
  waiting.release();
  await Promise.all([write.catch(() => {}), read]);
  assert(readFinished && writes === 1, 'A failure blocked reads or repeated a write.');
});
