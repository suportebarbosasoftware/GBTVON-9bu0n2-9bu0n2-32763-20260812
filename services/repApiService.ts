/**
 * GBTVON — Representative API Service
 * Handles all representative & sources operations via admin-api edge function.
 * Rep actions authenticate with repId + repPassword (NOT admin password).
 * Admin-only actions still use adminPassword via setRepAdminPassword().
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// Admin password — used only for admin-side rep management (addCredits, create, etc.)
let _adminPassword = '';
export function setRepAdminPassword(pw: string) { _adminPassword = pw; }
export function getRepAdminPassword() { return _adminPassword; }

// Rep credentials — stored after successful login for all rep actions
let _repId = '';
let _repPassword = '';
export function setRepCredentials(repId: string, password: string) {
  _repId = repId;
  _repPassword = password;
}
export function clearRepCredentials() { _repId = ''; _repPassword = ''; }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Representative {
  id: string;
  rep_number: string;
  name: string;
  credits: number;
  active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  // aggregated
  active_devices?: number;
  total_consumed?: number;
}

export interface Source {
  id: string;
  name: string;
  server_url: string;
  xtream_username: string;
  xtream_password: string;
  max_connections: number;
  rep_id: string | null;
  active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  // joined
  rep_name?: string;
  active_macs?: number;
}

export interface CreditTransaction {
  id: string;
  rep_id: string;
  amount: number;
  type: 'add' | 'consume';
  description?: string;
  device_mac?: string;
  days?: number;
  created_at: string;
}

export interface RepDevice {
  id: string;
  email: string;
  mac_address: string;
  client_name?: string;
  device_name?: string;
  platform?: string;
  activated: boolean;
  blocked_reason?: string | null;
  expires_at?: string | null;
  price?: number | null;
  plan_id?: string | null;
  source_id?: string | null;
  package_type?: 'iptv' | 'p2p' | null;
  created_at: string;
  last_seen_at?: string | null;
  current_content?: string | null;
  current_content_type?: string | null;
  notes?: string | null;
  grace_period_used?: boolean;
  sources?: { name: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callAdmin(action: string, payload?: Record<string, any>): Promise<any> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action, adminPassword: _adminPassword, ...payload },
  });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = await error.context.text(); } catch {}
    }
    throw new Error(msg);
  }
  return data;
}

/** Call an action authenticated by rep credentials (repId + repPassword) */
async function callRep(action: string, payload?: Record<string, any>): Promise<any> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action, repId: _repId, repPassword: _repPassword, ...payload },
  });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = await error.context.text(); } catch {}
    }
    throw new Error(msg);
  }
  return data;
}

/** Public call — no auth required */
async function callPublic(action: string, payload?: Record<string, any>): Promise<any> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action, ...payload },
  });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = await error.context.text(); } catch {}
    }
    throw new Error(msg);
  }
  return data;
}

// ─── Representatives (admin) ──────────────────────────────────────────────────

export async function getRepresentatives(): Promise<Representative[]> {
  const data = await callAdmin('getRepresentatives');
  return data?.representatives ?? [];
}

export async function createRepresentative(payload: {
  name: string; rep_number: string; password: string; credits?: number; notes?: string;
}): Promise<Representative> {
  const data = await callAdmin('createRepresentative', payload);
  return data.representative;
}

export async function updateRepresentative(id: string, payload: {
  name?: string; password?: string; active?: boolean; notes?: string;
}): Promise<void> {
  await callAdmin('updateRepresentative', { id, ...payload });
}

export async function deleteRepresentative(id: string): Promise<void> {
  await callAdmin('deleteRepresentative', { id });
}

export async function addCredits(repId: string, amount: number, description?: string): Promise<void> {
  await callAdmin('addCredits', { repId, amount, description });
}

export async function getCreditTransactions(repId: string): Promise<CreditTransaction[]> {
  const data = await callAdmin('getCreditTransactions', { repId });
  return data?.transactions ?? [];
}

// ─── Sources (admin) ──────────────────────────────────────────────────────────

export async function getSources(): Promise<Source[]> {
  const data = await callAdmin('getSources');
  return data?.sources ?? [];
}

export async function createSource(payload: {
  name: string; server_url: string; xtream_username: string; xtream_password: string;
  max_connections: number; rep_id?: string | null; notes?: string;
}): Promise<Source> {
  const data = await callAdmin('createSource', payload);
  return data.source;
}

export async function updateSource(id: string, payload: Partial<{
  name: string; server_url: string; xtream_username: string; xtream_password: string;
  max_connections: number; rep_id: string | null; active: boolean; notes: string;
}>): Promise<void> {
  await callAdmin('updateSource', { id, ...payload });
}

export async function deleteSource(id: string): Promise<void> {
  await callAdmin('deleteSource', { id });
}

// ─── Rep Panel (representative-side operations) ───────────────────────────────

export interface RepLoginResult {
  ok: boolean;
  rep?: Representative;
  error?: string;
}

export async function repLogin(repNumber: string, password: string): Promise<RepLoginResult> {
  try {
    const data = await callPublic('repLogin', { repNumber, password });
    if (!data?.ok) return { ok: false, error: data?.error ?? 'Código ou senha inválidos' };
    // Store credentials for subsequent rep actions
    if (data.rep?.id) setRepCredentials(data.rep.id, password);
    return { ok: true, rep: data.rep };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Validate a representative code publicly (for client login screen) */
export async function validateRepCode(repNumber: string): Promise<{ ok: boolean; repId?: string; repName?: string; error?: string }> {
  try {
    const data = await callPublic('validateRepCode', { repNumber });
    return data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getRepDevices(repId?: string): Promise<RepDevice[]> {
  const data = await callRep('getRepDevices', repId ? { repId } : {});
  return data?.devices ?? [];
}

export async function getRepSources(repId?: string): Promise<Source[]> {
  const data = await callRep('getRepSources', repId ? { repId } : {});
  return data?.sources ?? [];
}

export async function activateRepDevice(payload: {
  mac: string;
  email?: string;
  clientName?: string;
  sourceId: string;
  packageType: 'iptv' | 'p2p';
  days: number;
  expiresAtDate?: string;
}): Promise<void> {
  await callRep('activateRepDevice', payload);
}

export async function activateRepTest(payload: {
  mac: string;
  email?: string;
  clientName?: string;
  sourceId: string;
  packageType: 'iptv' | 'p2p';
  hours: number;
}): Promise<void> {
  await callRep('activateRepTest', payload);
}

/** Lookup a device by MAC address (to auto-fill client name) */
export async function lookupDeviceByMac(mac: string): Promise<{ found: boolean; client_name?: string; email?: string }> {
  try {
    const data = await callRep('lookupDeviceByMac', { mac: mac.trim().toUpperCase() });
    return data;
  } catch {
    return { found: false };
  }
}

export async function deactivateRepDevice(deviceId: string): Promise<void> {
  await callRep('deactivateRepDevice', { deviceId });
}

export async function blockRepDevice(deviceId: string, reason?: string): Promise<void> {
  await callRep('blockRepDevice', { deviceId, reason });
}

/** Unblock a device — does NOT consume credits */
export async function unblockRepDevice(deviceId: string): Promise<void> {
  await callRep('unblockRepDevice', { deviceId });
}

export async function deleteRepDevice(deviceId: string): Promise<void> {
  await callRep('deleteRepDevice', { deviceId });
}

/**
 * Renew a device's subscription by adding `days` to its current expiry.
 * Consumes proportional credits: days/30 (e.g. 15d = 0.50 cr, 32d = 1.07 cr).
 */
export async function renewRepDevice(deviceId: string, days: number): Promise<{ credit_cost: number; new_expiry: string }> {
  const data = await callRep('renewRepDevice', { deviceId, days });
  return { credit_cost: data?.credit_cost ?? 0, new_expiry: data?.new_expiry ?? '' };
}
