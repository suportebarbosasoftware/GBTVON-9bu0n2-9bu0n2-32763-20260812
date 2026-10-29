import { createPanelDatabaseFetch, PanelDatabaseTimeoutError } from './panelDatabaseFetch.ts';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('a responsive database read returns immediately with its original result', async () => {
  const transport: typeof fetch = async () => new Response('confirmed', { status: 200 });
  const request = createPanelDatabaseFetch(Date.now() + 1000, transport);
  const response = await request('https://example.test/database');
  assert(await response.text() === 'confirmed', 'The database result was altered.');
});
Deno.test('all authentication queries share a deadline, not a new timeout per query', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls += 1; return new Response('ok'); };
  const request = createPanelDatabaseFetch(Date.now() - 1, transport);
  let timeout = false;
  try { await request('https://example.test/database'); } catch (error) { timeout = error instanceof PanelDatabaseTimeoutError; }
  assert(timeout && calls === 0, 'A query started after the login deadline.');
});
Deno.test('a stalled read is cancelled and cannot hang authentication indefinitely', async () => {
  let aborted = false;
  const transport: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  });
  const request = createPanelDatabaseFetch(Date.now() + 30, transport);
  let timeout = false;
  try { await request('https://example.test/database'); } catch (error) { timeout = error instanceof PanelDatabaseTimeoutError; }
  assert(timeout && aborted, 'The stalled request was not bounded and cancelled.');
});
