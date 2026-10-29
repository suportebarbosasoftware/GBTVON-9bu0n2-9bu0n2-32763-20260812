/** Bounded requests, outage backoff for polling, and accurate outcome reporting. */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createPanelRequestGate } from '@/services/panelRequestGate';
import { getPanelScopeKey, publishPanelMutation } from '@/services/panelChangeService';
import { createPanelReadBackoff } from '@/services/panelReadBackoff';

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 0, code = 'request_failed') {
    super(status ? `[${status}] ${message}` : message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

export function isAdminAuthError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

const readBackoff = createPanelReadBackoff();
const pendingReads = new Map<string, Promise<any>>();
const pendingWrites = new Map<string, Promise<any>>();
const requestGate = createPanelRequestGate();
const loginActions = new Set(['rootAdminLogin', 'subAdminLogin', 'repLogin']);

function timeoutMessage(action: string, readOnly: boolean): string {
  if (loginActions.has(action)) return 'O servidor não respondeu ao login a tempo. Isso não indica senha incorreta. Tente novamente em instantes.';
  if (readOnly) return 'O servidor não respondeu à consulta a tempo. A lista não foi atualizada.';
  return 'O servidor não confirmou a operação a tempo. Ela pode ter sido aplicada. Atualize o cliente para conferir antes de tentar novamente.';
}

async function invokeOnce(body: Record<string, unknown>, readOnly: boolean, scopeKey: string): Promise<any> {
  const action = String(body.action ?? '');
  const startedAt = Date.now();
  const requestId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const options = { body: { ...body, requestId }, signal: controller.signal };
  try {
    const result = await Promise.race([
      getSupabaseClient().functions.invoke('admin-api', options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AdminApiError(timeoutMessage(action, readOnly), 0, 'request_timeout'));
          controller.abort();
        }, readOnly || loginActions.has(action) ? 18000 : 30000);
      }),
    ]);
    const { data, error } = result;
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const status = error.context?.status ?? 500;
        let message = error.message;
        let code = 'http_error';
        try {
          const text = await error.context.text();
          try {
            const parsed = text ? JSON.parse(text) : null;
            message = parsed?.error || parsed?.message || message;
            code = parsed?.code || code;
          } catch { message = text || message; }
        } catch { /* Keep the original status and message. */ }
        throw new AdminApiError(message, status, code);
      }
      throw new AdminApiError(loginActions.has(action) || readOnly
        ? 'Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente.'
        : 'A conexão foi interrompida antes da confirmação. Confira o cliente antes de repetir a operação.', 0, 'network_error');
    }
    if (!data || typeof data !== 'object') throw new AdminApiError('Resposta inválida do servidor.', 0, 'invalid_response');
    if (data.error && data.ok !== false) throw new AdminApiError(String(data.error), 0, data.code || 'operation_failed');
    if (!loginActions.has(action)) readBackoff.succeeded(scopeKey);
    console.info('[panel-request]', action, requestId, Date.now() - startedAt, 'response_received');
    return data;
  } catch (error) {
    if (!loginActions.has(action) && error instanceof AdminApiError && (['request_timeout', 'network_error'].includes(error.code) || error.status >= 500 || error.status === 499)) {
      readBackoff.failed(scopeKey);
    }
    // Diagnostics contain only action, duration and error class, never passwords, MACs or tokens.
    console.warn('[panel-request]', action, requestId, Date.now() - startedAt, error instanceof AdminApiError ? error.code : 'unexpected_error');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function invokeAdminApi(body: Record<string, unknown>, options: { refresh?: boolean } = {}): Promise<any> {
  const action = String(body.action ?? '');
  const readOnly = action.startsWith('get') || action === 'lookupDeviceByMac' || action === 'validateRepCode';
  const key = JSON.stringify(body);
  const scopeKey = getPanelScopeKey(body) ?? `public:${action}`;
  if (!readOnly) {
    // Repeated taps during an identical in-flight action share its confirmation, not a second renewal/debit.
    const pending = pendingWrites.get(key);
    if (pending) return pending;
    // Authentication has no write barrier. An old login/action must never hold a new panel's first read.
    // Actual mutations pause only new reads for their own identity.
    const operation = () => invokeOnce(body, false, scopeKey);
    const request = (loginActions.has(action) ? operation() : requestGate.runWrite(operation, scopeKey)).then(data => {
      if (!data.error && data.ok !== false) publishPanelMutation(body);
      return data;
    }).finally(() => { pendingWrites.delete(key); });
    pendingWrites.set(key, request);
    return request;
  }
  const pending = pendingReads.get(key);
  if (pending) return pending;
  const request = requestGate.runRead(() => {
    if (!options.refresh && readBackoff.shouldDelay(scopeKey)) {
      return Promise.reject(new AdminApiError('O servidor está sem resposta. A próxima consulta será feita automaticamente; login e ações continuam disponíveis.', 0, 'server_backoff'));
    }
    return invokeOnce(body, true, scopeKey);
  }, scopeKey).finally(() => { pendingReads.delete(key); });
  pendingReads.set(key, request);
  return request;
}
