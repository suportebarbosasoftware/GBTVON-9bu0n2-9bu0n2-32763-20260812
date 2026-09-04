/**
 * Admin API Service — GBTVON
 * All admin panel operations via the admin-api Edge Function.
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// Password is set at runtime by the admin UI — never stored in source code
let _adminPassword = '';
export function setAdminPassword(pwd: string) { _adminPassword = pwd; }

// Sub-admin session — stores session token (NOT password) issued by server at login
let _subAdminId = '';
let _subAdminToken = '';
export function setSubAdminCredentials(id: string, token: string) {
  _subAdminId = id;
  _subAdminToken = token;
}
export function clearSubAdminCredentials() {
  _subAdminId = '';
  _subAdminToken = '';
}
export function isSubAdminSession() { return !!_subAdminId; }

export interface SubAdmin {
  id: string;
  username: string;
  name: string;
  parent_id: string;
  active: boolean;
  notes?: string | null;
  created_at?: string;
}

export interface Device {
  id: string;
  email: string;
  mac_address: string;
  device_name: string | null;
  platform: string | null;
  plan_id: string | null;
  activated: boolean;
  activated_at: string | null;
  expires_at: string | null;
  last_seen_at: string | null;
  blocked_reason: string | null;
  block_reason_detail: string | null;
  blocked_at: string | null;
  grace_period_used: boolean;
  notes: string | null;
  price: number | null;
  client_name?: string | null;
  rep_id?: string | null;
  current_content: string | null;
  current_content_type: string | null;
  current_content_at: string | null;
  created_at: string;
  plans?: {
    id: string;
    name: string;
    server_url: string;
  } | null;
  representatives?: {
    rep_number: string;
    name: string;
  } | null;
}

export interface Plan {
  id: string;
  name: string;
  server_url: string;
  xtream_username: string;
  xtream_password: string;
  max_macs: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  active_macs?: number;
}

export interface AdminStats {
  total: number;
  active: number;
  pending: number;
  blocked: number;
  newToday: number;
  plans: number;
  online: number;
  watching: number;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  target_email: string | null;
  target_mac: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface WatchingDevice {
  id: string;
  email: string;
  mac_address: string;
  client_name?: string | null;
  device_name: string | null;
  platform: string | null;
  current_content: string;
  current_content_type: string | null;
  current_content_at: string;
  last_seen_at: string | null;
  rep_id?: string | null;
}

async function call(action: string, data?: object): Promise<any> {
  const supabase = getSupabaseClient();
  // Sub-admins: send adminId + sessionToken (token issued at login, never the raw password)
  // Root admin: send adminPassword (env-var secret, never stored in app source)
  const authPayload = _subAdminId
    ? { adminId: _subAdminId, sessionToken: _subAdminToken }
    : { adminPassword: _adminPassword };
  const { data: result, error } = await supabase.functions.invoke('admin-api', {
    body: { action, ...authPayload, data },
  });

  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const statusCode = error.context?.status ?? 500;
        const text = await error.context?.text();
        try {
          const parsed = text ? JSON.parse(text) : null;
          msg = parsed?.error || text || msg;
        } catch {
          msg = text || msg;
        }
        msg = `[${statusCode}] ${msg}`;
      } catch {
        msg = error.message;
      }
    }
    throw new Error(msg);
  }

  return result;
}

// ── Devices ──────────────────────────────────────────────
export async function getDevices(): Promise<Device[]> {
  const { devices } = await call('get_devices');
  return devices || [];
}

export async function activateDevice(deviceId: string, planId: string): Promise<void> {
  await call('activate_device', { deviceId, planId });
}

export async function deactivateDevice(deviceId: string): Promise<void> {
  await call('deactivate_device', { deviceId });
}

export async function blockDevice(deviceId: string, reasonDetail?: string): Promise<void> {
  await call('block_device', { deviceId, reasonDetail });
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await call('delete_device', { deviceId });
}

export async function deleteDevicesBulk(deviceIds: string[]): Promise<void> {
  await call('delete_devices_bulk', { deviceIds });
}

export async function deleteInactiveDevices(): Promise<void> {
  await call('delete_inactive_devices');
}

export async function updateDeviceNotes(deviceId: string, notes: string): Promise<void> {
  await call('update_device_notes', { deviceId, notes });
}

export async function setDeviceExpiry(deviceId: string, expiresAt: string | null): Promise<void> {
  await call('set_device_expiry', { deviceId, expiresAt });
}

export async function setDevicePrice(deviceId: string, price: number | null): Promise<void> {
  await call('set_device_price', { deviceId, price });
}

export async function grantGracePeriod(deviceId: string): Promise<void> {
  await call('grant_grace_period', { deviceId });
}

// ── Plans ─────────────────────────────────────────────────
export async function getPlans(): Promise<Plan[]> {
  const { plans } = await call('get_plans');
  return plans || [];
}

export async function createPlan(data: {
  name: string;
  server_url: string;
  xtream_username: string;
  xtream_password: string;
  max_macs: number;
  notes?: string;
}): Promise<Plan> {
  const { plan } = await call('create_plan', data);
  return plan;
}

export async function updatePlan(planId: string, updates: Partial<Plan>): Promise<void> {
  await call('update_plan', { planId, updates });
}

export async function deletePlan(planId: string): Promise<void> {
  await call('delete_plan', { planId });
}

// ── Stats ─────────────────────────────────────────────────
export async function getStats(): Promise<AdminStats> {
  const { stats } = await call('get_stats');
  return stats;
}

// ── Watching now (real-time content monitoring) ────────────
export async function getWatchingNow(): Promise<WatchingDevice[]> {
  const { watching } = await call('get_watching_now');
  return watching || [];
}

// ── Notifications ─────────────────────────────────────────
export async function sendNotification(params: {
  title: string;
  message: string;
  targetEmail?: string;
  targetMac?: string;
}): Promise<void> {
  await call('send_notification', params);
}

export async function getNotifications(): Promise<Notification[]> {
  const { notifications } = await call('get_notifications');
  return notifications || [];
}

export async function deleteNotification(notificationId: string): Promise<void> {
  await call('delete_notification', { notificationId });
}

// ── Pre-authorize ─────────────────────────────────────────
export async function preAuthorizeEmail(email: string, planId: string, macAddress: string): Promise<void> {
  await call('pre_authorize_email', { email, planId, macAddress });
}

// ── Sub-admin management (root admin only) ────────────────────
export async function getSubAdmins(): Promise<SubAdmin[]> {
  const supabase = getSupabaseClient();
  const { data: result } = await supabase.functions.invoke('admin-api', {
    body: { action: 'getSubAdmins', adminPassword: _adminPassword },
  });
  return result?.admins || [];
}

export async function createSubAdmin(params: { username: string; password: string; name: string; notes?: string }): Promise<SubAdmin> {
  const supabase = getSupabaseClient();
  const { data: result } = await supabase.functions.invoke('admin-api', {
    body: { action: 'createSubAdmin', adminPassword: _adminPassword, ...params },
  });
  return result?.admin;
}

export async function updateSubAdmin(id: string, updates: { name?: string; password?: string; active?: boolean; notes?: string }): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.functions.invoke('admin-api', {
    body: { action: 'updateSubAdmin', adminPassword: _adminPassword, id, ...updates },
  });
}

export async function deleteSubAdmin(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.functions.invoke('admin-api', {
    body: { action: 'deleteSubAdmin', adminPassword: _adminPassword, id },
  });
}

export async function subAdminLogin(username: string, password: string): Promise<{ ok: boolean; admin?: SubAdmin; sessionToken?: string; error?: string }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action: 'subAdminLogin', username, password },
  });
  if (error || !data?.ok) return { ok: false, error: data?.error || 'Erro ao autenticar' };
  // Server returns a session token — password is never stored or re-sent
  return { ok: true, admin: data.admin, sessionToken: data.sessionToken };
}

// ── Content tracking (called from player, no admin password) ─
export async function updateCurrentContent(
  macAddress: string,
  content: string | null,
  contentType: string | null
): Promise<void> {
  const supabase = getSupabaseClient();
  // Send flat body (no data wrapper) so edge function gets mac_address directly
  await supabase.functions.invoke('admin-api', {
    body: {
      action: 'update_current_content',
      mac_address: macAddress,
      content,
      content_type: contentType,
    },
  });
}
