import { readPanelRows, countPanelRelations } from './adminPanelData.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('MAC pagination includes all rows and retains existing representative scope', async () => {
  const fixtures = Array.from({ length: 1201 }, (_, index) => ({ id: String(index), rep_id: 'rep-a' }));
  const ranges: number[] = [];
  const result = await readPanelRows(() => ({
    range: async (from: number, to: number) => {
      ranges.push(from);
      return { data: fixtures.slice(from, to + 1), error: null };
    },
  }));
  assert(result.length === 1201, 'Some MACs were omitted');
  assert(result.every(row => row.rep_id === 'rep-a'), 'Representative scope changed');
  assert(ranges.join(',') === '0,500,1000', 'Pagination ranges were incorrect');
});

Deno.test('MAC read failure rejects instead of reporting an empty client list', async () => {
  let rejected = false;
  try {
    await readPanelRows(() => ({ range: async () => ({ data: null, error: new Error('network failure') }) }));
  } catch { rejected = true; }
  assert(rejected, 'Read failure was mistaken for an empty list');
});

Deno.test('Source counts are calculated from the supplied representative rows without mutating them', () => {
  const rows = [{ source_id: 'source-a' }, { source_id: 'source-a' }, { source_id: 'source-b' }, { source_id: null }];
  const before = JSON.stringify(rows);
  const counts = countPanelRelations(rows, 'source_id');
  assert(counts.get('source-a') === 2, 'Wrong source-a count');
  assert(counts.get('source-b') === 1, 'Wrong source-b count');
  assert(!counts.has('null'), 'Unassigned MACs were counted as a source');
  assert(JSON.stringify(rows) === before, 'Input rows were mutated');
});
