/** Shared transport: accurate HTTP errors, bounded waits and read-only network retries. */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

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

async function invokeOnce(body: Record<string, unknown>): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  // Pass an options variable for compatibility with older client type declarations.
  const options = { body, signal: controller.signal };
  try {
    const result = await Promise.race([
      getSupabaseClient().functions.invoke('admin-api', options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AdminApiError(
            'O servidor demorou para responder. Os dados anteriores foram mantidos; tente atualizar novamente.',
            0, 'request_timeout',
          ));
          controller.abort();
        }, 18000);
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
        } catch { /* Preserve the original error when its response cannot be read. */ }
        throw new AdminApiError(message, status, code);
      }
      throw new AdminApiError('Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente.', 0, 'network_error');
    }
    if (!data || typeof data !== 'object') throw new AdminApiError('Resposta inválida do servidor.', 0, 'invalid_response');
    if (data.error && data.ok !== false) throw new AdminApiError(String(data.error), 0, data.code || 'operation_failed');
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function invokeAdminApi(body: Record<string, unknown>): Promise<any> {
  try { return await invokeOnce(body); }
  catch (error) {
    // Never retry login, changes, credits, activation or deletion automatically.
    const readOnly = typeof body.action === 'string' && (body.action.startsWith('get_') || body.action.startsWith('get'));
    if (!readOnly || !(error instanceof AdminApiError) || error.code !== 'network_error') throw error;
    return invokeOnce(body);
  }
}
