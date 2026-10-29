// Run: deno test supabase/functions/_shared/panelMetadata.test.ts
// @ts-ignore Deno uses explicit TypeScript file extensions.
import { readPanelMetadata } from './adminPanelData.ts';
declare const Deno: { test: (name: string, test: () => Promise<void>) => void };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

Deno.test('metadata starts in parallel instead of waiting for tab navigation', async () => {
  const started: string[] = [];
  let release: () => void = () => {};
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const result = readPanelMetadata({
    plans: async () => { started.push('plans'); await barrier; return [{ id: 'plan-a' }]; },
    sources: async () => { started.push('sources'); await barrier; return [{ id: 'source-a' }]; },
    reps: async () => { started.push('reps'); await barrier; return [{ id: 'rep-a' }]; },
  });
  await Promise.resolve();
  assert(started.length === 3, 'Metadata queries were serialized.');
  release();
  const bundle = await result;
  assert(bundle.values.sources[0].id === 'source-a' && !Object.keys(bundle.errors).length, 'Ready data was lost.');
});

Deno.test('an optional source timeout preserves successful metadata and records an error rather than an empty list', async () => {
  const result = await readPanelMetadata({
    plans: async () => [{ id: 'plan-a' }],
    sources: async () => { throw new Error('panel_database_timeout'); },
    reps: async () => [],
  });
  assert(result.values.plans.length === 1, 'A source failure discarded plans.');
  assert(result.values.sources === undefined && typeof result.errors.sources === 'string', 'Failure was reported as an empty source list.');
  assert(Array.isArray(result.values.reps) && result.values.reps.length === 0, 'Confirmed empty lists were not preserved.');
});

Deno.test('synchronous loader failures are isolated and never expose database error details', async () => {
  const result = await readPanelMetadata({
    sources: () => { throw new Error('private database detail'); },
    plans: async () => [],
  });
  assert(result.values.plans.length === 0 && result.errors.sources.length > 0, 'Synchronous errors escaped the optional bundle.');
  assert(!result.errors.sources.includes('private'), 'Internal database details were exposed.');
});
