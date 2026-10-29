// Run with: deno test services/panelReadBackoff.test.ts
// @ts-ignore Deno supports explicit TypeScript imports.
import { createPanelReadBackoff } from './panelReadBackoff.ts';
declare const Deno: { test: (name: string, test: () => void) => void };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('an outage in one representative does not delay the administrator or another representative', () => {
  let time = 1000;
  const backoff = createPanelReadBackoff(() => time);
  backoff.failed('rep-a');
  assert(backoff.shouldDelay('rep-a'), 'The failed session did not receive a cooldown.');
  assert(!backoff.shouldDelay('root') && !backoff.shouldDelay('rep-b'), 'An unrelated session was delayed.');
  time += 10000;
  assert(!backoff.shouldDelay('rep-a'), 'Automatic synchronization never recovered.');
});
Deno.test('successful reads reset only their own session cooldown', () => {
  const backoff = createPanelReadBackoff(() => 1000);
  backoff.failed('rep-a'); backoff.failed('rep-b'); backoff.succeeded('rep-a');
  assert(!backoff.shouldDelay('rep-a') && backoff.shouldDelay('rep-b'), 'A success reset the wrong session.');
});
