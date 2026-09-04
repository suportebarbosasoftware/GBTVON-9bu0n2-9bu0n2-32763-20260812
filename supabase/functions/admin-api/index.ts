// admin-api Edge Function — GBTVON
// Handles all admin + representative operations
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD') ?? '';

/** Normalize MAC to uppercase colon format XX:XX:XX:XX:XX:XX */
function normalizeMac(mac: string): string {
  const hex = mac.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
  if (hex.length !== 12) return mac.trim().toUpperCase();
  return hex.match(/.{2}/g)!.join(':');
}

/** Generate a secure random session token */
function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { action, adminPassword } = body;

    // ── Public / no-auth actions ──────────────────────────────────────────────

    if (action === 'update_current_content') {
      const rawData = body.data || body;
      const { mac_address, content, content_type } = rawData;
      console.log('[update_current_content] mac:', mac_address, 'content:', content);
      if (!mac_address) {
        return json({ success: false, error: 'mac_address required' });
      }
      const normalizedMac = normalizeMac(mac_address);
      let { data: updated, error: updateErr } = await supabase.from('devices').update({
        current_content: content || null,
        current_content_type: content_type || null,
        current_content_at: content ? new Date().toISOString() : null,
        last_seen_at: new Date().toISOString(),
      }).eq('mac_address', normalizedMac).select('id');
      if (!updated?.length && !updateErr) {
        const r2 = await supabase.from('devices').update({
          current_content: content || null,
          current_content_type: content_type || null,
          current_content_at: content ? new Date().toISOString() : null,
          last_seen_at: new Date().toISOString(),
        }).eq('mac_address', mac_address.trim()).select('id');
        updated = r2.data;
        updateErr = r2.error;
      }
      console.log('[update_current_content] updated rows:', updated?.length ?? 0, 'error:', updateErr?.message);
      return json({ success: true, updated: updated?.length ?? 0 });
    }

    // ── Representative login ──────────────────────────────────────────────────

    if (action === 'repLogin') {
      const { repNumber, password } = body;
      if (!repNumber || !password) return json({ ok: false, error: 'Código e senha obrigatórios' });
      const { data: rep, error } = await supabase
        .from('representatives')
        .select('*')
        .eq('rep_number', repNumber)
        .eq('active', true)
        .maybeSingle();
      if (error || !rep) return json({ ok: false, error: 'Representante não encontrado' });
      if (rep.password_hash !== password) return json({ ok: false, error: 'Senha incorreta' });
      return json({ ok: true, rep });
    }

    if (action === 'validateRepCode') {
      const { repNumber } = body;
      if (!repNumber) return json({ ok: false });
      const { data: rep } = await supabase
        .from('representatives')
        .select('id, name, rep_number')
        .eq('rep_number', repNumber)
        .eq('active', true)
        .maybeSingle();
      if (!rep) return json({ ok: false, error: 'Código de representante não encontrado' });
      return json({ ok: true, repId: rep.id, repName: rep.name });
    }

    // ── Sub-admin login — returns session token, never re-sends password ──────

    if (action === 'subAdminLogin') {
      const { username, password } = body;
      if (!username || !password) return json({ ok: false, error: 'Usuário e senha obrigatórios' });
      const { data: adm } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username.trim().toLowerCase())
        .eq('active', true)
        .not('parent_id', 'is', null)
        .maybeSingle();
      if (!adm) return json({ ok: false, error: 'Sub-admin não encontrado' });
      if (adm.password_hash !== password) return json({ ok: false, error: 'Senha incorreta' });

      // Generate session token — expires in 24h
      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('admins').update({
        session_token: token,
        session_expires_at: expiresAt,
      }).eq('id', adm.id);

      return json({
        ok: true,
        admin: { id: adm.id, name: adm.name, username: adm.username, parent_id: adm.parent_id },
        sessionToken: token,
      });
    }

    // ── Helper functions ──────────────────────────────────────────────────────

    async function validateRep(repId: string, repPassword: string): Promise<boolean> {
      const { data: rep } = await supabase
        .from('representatives')
        .select('password_hash, active')
        .eq('id', repId)
        .eq('active', true)
        .maybeSingle();
      return !!rep && rep.password_hash === repPassword;
    }

    function computeCreditCost(days: number): number {
      return Math.round((days / 30) * 100) / 100;
    }

    // ── Rep Panel actions ─────────────────────────────────────────────────────

    if (action === 'getRepDevices') {
      const { repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const { data: devices, error } = await supabase
        .from('devices')
        .select('*, sources(name)')
        .eq('rep_id', repId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ devices: devices || [] });
    }

    if (action === 'getRepSources') {
      const { repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const { data: sources, error } = await supabase
        .from('sources')
        .select('*')
        .eq('rep_id', repId)
        .eq('active', true);
      if (error) throw error;
      const withCount = await Promise.all((sources || []).map(async (s: any) => {
        const { count } = await supabase
          .from('devices')
          .select('*', { count: 'exact', head: true })
          .eq('source_id', s.id)
          .eq('activated', true);
        return { ...s, active_macs: count || 0 };
      }));
      return json({ sources: withCount });
    }

    if (action === 'activateRepDevice') {
      const { repId, repPassword, mac, email, clientName, sourceId, packageType, days, expiresAtDate } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      if (!repId || !mac || !sourceId || !days) throw new Error('Dados incompletos');
      const normalizedMac = normalizeMac(mac);
      const { data: rep } = await supabase.from('representatives').select('credits, admin_id').eq('id', repId).single();
      if (!rep) throw new Error('Representante não encontrado');
      const repAdminId: string | null = rep.admin_id ?? null;
      const creditCost = computeCreditCost(parseInt(days));
      if (rep.credits < creditCost) throw new Error(`Créditos insuficientes. Você tem ${rep.credits} crédito(s), esta ativação custa ${creditCost.toFixed(2)}.`);
      const { data: source } = await supabase.from('sources').select('*').eq('id', sourceId).single();
      if (!source) throw new Error('Fonte não encontrada');
      let planId: string | null = null;
      const planMatchQ = supabase.from('plans').select('id').eq('server_url', source.server_url).eq('xtream_username', source.xtream_username);
      const { data: existingPlan } = repAdminId
        ? await planMatchQ.eq('admin_id', repAdminId).maybeSingle()
        : await planMatchQ.is('admin_id', null).maybeSingle();
      if (existingPlan) { planId = existingPlan.id; }
      else {
        const { data: np } = await supabase.from('plans').insert({
          name: source.name, server_url: source.server_url, xtream_username: source.xtream_username,
          xtream_password: source.xtream_password, max_macs: source.max_connections, admin_id: repAdminId
        }).select('id').single();
        planId = np?.id ?? null;
      }
      const now = new Date().toISOString();
      let expiresAt: Date;
      if (expiresAtDate) { expiresAt = new Date(expiresAtDate); } else { expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + parseInt(days)); }
      const normalizedEmail = email ? email.toLowerCase().trim() : `mac_${normalizedMac.replace(/:/g, '').toLowerCase()}@gbtvon.local`;
      const { data: existingDev } = await supabase.from('devices').select('id').eq('mac_address', normalizedMac).maybeSingle();
      if (existingDev) {
        await supabase.from('devices').update({
          email: normalizedEmail, client_name: clientName || null, plan_id: planId, source_id: sourceId,
          package_type: packageType, rep_id: repId, admin_id: repAdminId,
          activated: true, activated_at: now, expires_at: expiresAt.toISOString(),
          blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now
        }).eq('mac_address', normalizedMac);
      } else {
        await supabase.from('devices').insert({
          email: normalizedEmail, mac_address: normalizedMac, client_name: clientName || null,
          plan_id: planId, source_id: sourceId, package_type: packageType, rep_id: repId,
          admin_id: repAdminId, activated: true, activated_at: now, expires_at: expiresAt.toISOString(),
          device_name: 'Ativado pelo representante', platform: 'unknown', last_seen_at: now
        });
      }
      await supabase.from('representatives').update({ credits: rep.credits - creditCost, updated_at: now }).eq('id', repId);
      await supabase.from('credit_transactions').insert({
        rep_id: repId, amount: Math.ceil(creditCost), type: 'consume',
        description: `Ativação ${parseInt(days)}d ${packageType?.toUpperCase()} — ${normalizedMac} (custo real: ${creditCost.toFixed(2)} cr.)`,
        device_mac: normalizedMac, days: parseInt(days)
      });
      return json({ success: true, credit_cost: creditCost });
    }

    if (action === 'activateRepTest') {
      const { repId, repPassword, mac, email, clientName, sourceId, packageType, hours } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      if (!mac || !sourceId || !hours) throw new Error('Dados incompletos');
      const normalizedMac = normalizeMac(mac);
      const hoursNum = Math.min(Math.max(1, parseInt(hours)), 6);
      const { data: repInfo } = await supabase.from('representatives').select('admin_id').eq('id', repId).maybeSingle();
      const repAdminId: string | null = repInfo?.admin_id ?? null;
      const { data: source } = await supabase.from('sources').select('*').eq('id', sourceId).single();
      if (!source) throw new Error('Fonte não encontrada');
      let planId: string | null = null;
      const planMatchQ2 = supabase.from('plans').select('id').eq('server_url', source.server_url).eq('xtream_username', source.xtream_username);
      const { data: existingPlan } = repAdminId
        ? await planMatchQ2.eq('admin_id', repAdminId).maybeSingle()
        : await planMatchQ2.is('admin_id', null).maybeSingle();
      if (existingPlan) { planId = existingPlan.id; }
      else {
        const { data: np } = await supabase.from('plans').insert({
          name: source.name, server_url: source.server_url, xtream_username: source.xtream_username,
          xtream_password: source.xtream_password, max_macs: source.max_connections, admin_id: repAdminId
        }).select('id').single();
        planId = np?.id ?? null;
      }
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + hoursNum * 60 * 60 * 1000).toISOString();
      const normalizedEmail = email ? email.toLowerCase().trim() : `mac_${normalizedMac.replace(/:/g, '').toLowerCase()}@gbtvon.local`;
      const { data: existingDev } = await supabase.from('devices').select('id').eq('mac_address', normalizedMac).maybeSingle();
      if (existingDev) {
        await supabase.from('devices').update({
          email: normalizedEmail, client_name: clientName || null, plan_id: planId, source_id: sourceId,
          package_type: packageType || 'iptv', rep_id: repId, admin_id: repAdminId,
          activated: true, activated_at: now, expires_at: expiresAt,
          blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now
        }).eq('mac_address', normalizedMac);
      } else {
        await supabase.from('devices').insert({
          email: normalizedEmail, mac_address: normalizedMac, client_name: clientName || null,
          plan_id: planId, source_id: sourceId, package_type: packageType || 'iptv', rep_id: repId,
          admin_id: repAdminId, activated: true, activated_at: now, expires_at: expiresAt,
          device_name: 'Teste gratuito', platform: 'unknown', last_seen_at: now
        });
      }
      await supabase.from('credit_transactions').insert({
        rep_id: repId, amount: 0, type: 'consume',
        description: `Teste ${hoursNum}h — ${normalizedMac}`, device_mac: normalizedMac, days: 0
      });
      return json({ success: true });
    }

    if (action === 'deactivateRepDevice') {
      const { deviceId, repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      await supabase.from('devices').update({ activated: false, updated_at: new Date().toISOString() }).eq('id', deviceId).eq('rep_id', repId);
      return json({ success: true });
    }

    if (action === 'blockRepDevice') {
      const { deviceId, repId, repPassword, reason } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const now = new Date().toISOString();
      await supabase.from('devices').update({
        activated: false, blocked_reason: 'manual', block_reason_detail: reason || 'Bloqueado pelo representante',
        blocked_at: now, updated_at: now
      }).eq('id', deviceId).eq('rep_id', repId);
      return json({ success: true });
    }

    if (action === 'unblockRepDevice') {
      const { deviceId, repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const now = new Date().toISOString();
      await supabase.from('devices').update({
        activated: true, blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now
      }).eq('id', deviceId).eq('rep_id', repId);
      return json({ success: true });
    }

    if (action === 'deleteRepDevice') {
      const { deviceId, repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const { error } = await supabase.from('devices').delete().eq('id', deviceId).eq('rep_id', repId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'renewRepDevice') {
      const { deviceId, repId, repPassword, days } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      if (!deviceId || !days) throw new Error('Dados incompletos');
      const daysNum = Math.max(1, parseInt(days));
      const creditCost = computeCreditCost(daysNum);
      const { data: device } = await supabase.from('devices').select('id, expires_at, mac_address').eq('id', deviceId).eq('rep_id', repId).maybeSingle();
      if (!device) throw new Error('Dispositivo não encontrado na sua rede');
      const { data: rep } = await supabase.from('representatives').select('credits').eq('id', repId).single();
      if (!rep) throw new Error('Representante não encontrado');
      if (rep.credits < creditCost) throw new Error(`Créditos insuficientes. Você tem ${rep.credits} crédito(s), esta renovação custa ${creditCost.toFixed(2)}.`);
      const baseDate = device.expires_at && new Date(device.expires_at) > new Date() ? new Date(device.expires_at) : new Date();
      baseDate.setDate(baseDate.getDate() + daysNum);
      const newExpiry = baseDate.toISOString();
      const now = new Date().toISOString();
      await supabase.from('devices').update({
        expires_at: newExpiry, activated: true, blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now
      }).eq('id', deviceId);
      await supabase.from('representatives').update({ credits: rep.credits - creditCost, updated_at: now }).eq('id', repId);
      await supabase.from('credit_transactions').insert({
        rep_id: repId, amount: Math.ceil(creditCost), type: 'consume',
        description: `Renovação ${daysNum}d — ${device.mac_address} (custo real: ${creditCost.toFixed(2)} cr.)`,
        device_mac: device.mac_address, days: daysNum
      });
      return json({ success: true, new_expiry: newExpiry, credit_cost: creditCost });
    }

    if (action === 'changeRepDeviceSource') {
      const { deviceId, repId, repPassword, sourceId } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      if (!deviceId || !sourceId) throw new Error('Dados incompletos');
      const { data: repInfoCS } = await supabase.from('representatives').select('admin_id').eq('id', repId).maybeSingle();
      const repAdminIdCS: string | null = repInfoCS?.admin_id ?? null;
      const { data: source } = await supabase.from('sources').select('*').eq('id', sourceId).eq('rep_id', repId).maybeSingle();
      if (!source) throw new Error('Fonte não encontrada ou não pertence a este representante');
      let planId: string | null = null;
      const planMatchQ3 = supabase.from('plans').select('id').eq('server_url', source.server_url).eq('xtream_username', source.xtream_username);
      const { data: existingPlan } = repAdminIdCS
        ? await planMatchQ3.eq('admin_id', repAdminIdCS).maybeSingle()
        : await planMatchQ3.is('admin_id', null).maybeSingle();
      if (existingPlan) { planId = existingPlan.id; }
      else {
        const { data: np } = await supabase.from('plans').insert({
          name: source.name, server_url: source.server_url, xtream_username: source.xtream_username,
          xtream_password: source.xtream_password, max_macs: source.max_connections, admin_id: repAdminIdCS
        }).select('id').single();
        planId = np?.id ?? null;
      }
      const { error } = await supabase.from('devices').update({
        source_id: sourceId, plan_id: planId, updated_at: new Date().toISOString()
      }).eq('id', deviceId).eq('rep_id', repId);
      if (error) throw error;
      return json({ success: true, source_name: source.name });
    }

    if (action === 'updateRepDevicePrice') {
      const { deviceId, repId, repPassword, price } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      const { error } = await supabase.from('devices').update({
        price: price != null ? parseFloat(String(price)) : null, updated_at: new Date().toISOString()
      }).eq('id', deviceId).eq('rep_id', repId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'lookupDeviceByMac') {
      const { mac, repId, repPassword } = body;
      if (!await validateRep(repId, repPassword)) return authError();
      if (!mac) return json({ found: false });
      const normalizedMac = normalizeMac(mac);
      const { data: dev } = await supabase.from('devices').select('client_name, email, mac_address').eq('mac_address', normalizedMac).maybeSingle();
      if (!dev) return json({ found: false });
      return json({ found: true, client_name: dev.client_name || '', email: dev.email || '' });
    }

    // ── Admin auth — resolve identity ─────────────────────────────────────────
    //
    // Sub-admins: pass adminId + sessionToken (issued at login, never the raw password)
    // Root admin: pass adminPassword (env var, never stored in app)
    //
    const { adminId, sessionToken } = body;
    let resolvedAdminId: string | null = null;

    if (adminId && sessionToken) {
      // Validate session token — must exist, not expired, belong to a sub-admin
      const { data: subAdm } = await supabase
        .from('admins')
        .select('id, parent_id, active, session_expires_at')
        .eq('id', adminId)
        .eq('session_token', sessionToken)
        .eq('active', true)
        .not('parent_id', 'is', null)
        .maybeSingle();
      if (!subAdm) {
        return new Response(JSON.stringify({ error: 'Sessão inválida. Faça login novamente.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      // Check token expiry
      if (subAdm.session_expires_at && new Date(subAdm.session_expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'Sessão expirada. Faça login novamente.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      resolvedAdminId = subAdm.id;
    } else {
      const isAdminAction = adminPassword !== undefined;
      if (isAdminAction && adminPassword !== ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ error: 'Senha incorreta.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      resolvedAdminId = null; // root admin
    }

    // ── Scope helpers ─────────────────────────────────────────────────────────

    function scopeDevices(q: any) {
      return resolvedAdminId ? q.eq('admin_id', resolvedAdminId) : q.is('admin_id', null);
    }
    function scopeReps(q: any) {
      return resolvedAdminId ? q.eq('admin_id', resolvedAdminId) : q.is('admin_id', null);
    }
    function scopeSources(q: any) {
      return resolvedAdminId ? q.eq('admin_id', resolvedAdminId) : q.is('admin_id', null);
    }
    function scopePlans(q: any) {
      return resolvedAdminId ? q.eq('admin_id', resolvedAdminId) : q.is('admin_id', null);
    }

    // ── Sub-admin management (root admin only) ────────────────────────────────

    if (action === 'getSubAdmins') {
      if (resolvedAdminId) return json({ error: 'Apenas o admin root pode gerenciar sub-admins.' });
      const { data: admins, error } = await supabase
        .from('admins')
        .select('id, username, name, active, notes, created_at, parent_id')
        .not('parent_id', 'is', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({ admins: admins || [] });
    }

    if (action === 'createSubAdmin') {
      if (resolvedAdminId) return json({ error: 'Apenas o admin root pode criar sub-admins.' });
      const { username, password, name, notes } = body;
      if (!username || !password || !name) throw new Error('Usuário, senha e nome obrigatórios');
      const { data: existing } = await supabase.from('admins').select('id').is('parent_id', null).limit(1).maybeSingle();
      let rootId = existing?.id;
      if (!rootId) {
        const { data: root } = await supabase.from('admins').insert({
          username: 'root', password_hash: ADMIN_PASSWORD, name: 'Admin Principal', parent_id: null
        }).select('id').single();
        rootId = root?.id;
      }
      const { data: newAdmin, error } = await supabase.from('admins').insert({
        username: username.trim().toLowerCase(), password_hash: password,
        name: name.trim(), parent_id: rootId, notes: notes || null,
      }).select().single();
      if (error) throw error;
      return json({ admin: newAdmin });
    }

    if (action === 'updateSubAdmin') {
      if (resolvedAdminId) return json({ error: 'Apenas o admin root pode editar sub-admins.' });
      const { id, name, password, active, notes } = body;
      const updates: any = { updated_at: new Date().toISOString() };
      if (name) updates.name = name;
      if (password) updates.password_hash = password;
      if (active !== undefined) updates.active = active;
      if (notes !== undefined) updates.notes = notes;
      // Invalidate session when password changes
      if (password) {
        updates.session_token = null;
        updates.session_expires_at = null;
      }
      const { error } = await supabase.from('admins').update(updates).eq('id', id).not('parent_id', 'is', null);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'deleteSubAdmin') {
      if (resolvedAdminId) return json({ error: 'Apenas o admin root pode excluir sub-admins.' });
      const { id } = body;
      await Promise.all([
        supabase.from('representatives').update({ admin_id: null }).eq('admin_id', id),
        supabase.from('sources').update({ admin_id: null }).eq('admin_id', id),
        supabase.from('devices').update({ admin_id: null }).eq('admin_id', id),
        supabase.from('plans').update({ admin_id: null }).eq('admin_id', id),
      ]);
      const { error } = await supabase.from('admins').delete().eq('id', id).not('parent_id', 'is', null);
      if (error) throw error;
      return json({ success: true });
    }

    // ── Admin-only: Rep management ────────────────────────────────────────────

    if (action === 'getRepresentatives') {
      const { data: reps, error } = await scopeReps(
        supabase.from('representatives').select('*').order('rep_number', { ascending: true })
      );
      if (error) throw error;
      const withStats = await Promise.all((reps || []).map(async (r: any) => {
        const { count: activeDevices } = await supabase.from('devices')
          .select('*', { count: 'exact', head: true }).eq('rep_id', r.id).eq('activated', true);
        const { data: consumed } = await supabase.from('credit_transactions')
          .select('amount').eq('rep_id', r.id).eq('type', 'consume');
        const totalConsumed = (consumed || []).reduce((s: number, t: any) => s + t.amount, 0);
        return { ...r, active_devices: activeDevices || 0, total_consumed: totalConsumed };
      }));
      return json({ representatives: withStats });
    }

    if (action === 'createRepresentative') {
      const { name, rep_number, password, credits, notes } = body;
      if (!name || !rep_number || !password) throw new Error('Nome, número e senha obrigatórios');
      const { data: rep, error } = await supabase.from('representatives').insert({
        name, rep_number, password_hash: password, credits: credits || 0,
        notes: notes || null, admin_id: resolvedAdminId
      }).select().single();
      if (error) throw error;
      return json({ representative: rep });
    }

    if (action === 'updateRepresentative') {
      const { id, name, password, active, notes } = body;
      const updates: any = { updated_at: new Date().toISOString() };
      if (name !== undefined) updates.name = name;
      if (password !== undefined && password !== '') updates.password_hash = password;
      if (active !== undefined) updates.active = active;
      if (notes !== undefined) updates.notes = notes;
      const { error } = await supabase.from('representatives').update(updates).eq('id', id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'deleteRepresentative') {
      const { id } = body;
      await supabase.from('devices').update({ rep_id: null }).eq('rep_id', id);
      await supabase.from('sources').update({ rep_id: null }).eq('rep_id', id);
      const { error } = await supabase.from('representatives').delete().eq('id', id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'addCredits') {
      const { repId, amount, description } = body;
      const { data: rep } = await supabase.from('representatives').select('credits').eq('id', repId).single();
      if (!rep) throw new Error('Representante não encontrado');
      await supabase.from('representatives').update({
        credits: rep.credits + amount, updated_at: new Date().toISOString()
      }).eq('id', repId);
      await supabase.from('credit_transactions').insert({
        rep_id: repId, amount, type: 'add', description: description || 'Créditos adicionados pelo admin'
      });
      return json({ success: true });
    }

    if (action === 'removeCredits') {
      const { repId, amount, description } = body;
      if (!amount || amount < 1) throw new Error('Quantidade inválida');
      const { data: rep } = await supabase.from('representatives').select('credits').eq('id', repId).single();
      if (!rep) throw new Error('Representante não encontrado');
      const newCredits = Math.max(0, rep.credits - amount);
      await supabase.from('representatives').update({
        credits: newCredits, updated_at: new Date().toISOString()
      }).eq('id', repId);
      await supabase.from('credit_transactions').insert({
        rep_id: repId, amount: -amount, type: 'consume', description: description || 'Créditos removidos pelo admin'
      });
      return json({ success: true, new_balance: newCredits });
    }

    if (action === 'getCreditTransactions') {
      const { repId } = body;
      const { data: transactions, error } = await supabase.from('credit_transactions')
        .select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return json({ transactions: transactions || [] });
    }

    if (action === 'getSources') {
      const { data: sources, error } = await scopeSources(
        supabase.from('sources').select('*, representatives(name)').order('created_at', { ascending: false })
      );
      if (error) throw error;
      const withCount = await Promise.all((sources || []).map(async (s: any) => {
        const { count } = await supabase.from('devices')
          .select('*', { count: 'exact', head: true }).eq('source_id', s.id).eq('activated', true);
        return { ...s, active_macs: count || 0, rep_name: s.representatives?.name };
      }));
      return json({ sources: withCount });
    }

    if (action === 'createSource') {
      const { name, server_url, xtream_username, xtream_password, max_connections, rep_id, notes } = body;
      if (!name || !server_url || !xtream_username || !xtream_password) throw new Error('Campos obrigatórios faltando');
      const { data: source, error } = await supabase.from('sources').insert({
        name, server_url, xtream_username, xtream_password,
        max_connections: max_connections || 5, rep_id: rep_id || null,
        notes: notes || null, admin_id: resolvedAdminId
      }).select().single();
      if (error) throw error;
      return json({ source });
    }

    if (action === 'updateSource') {
      const { id, ...rest } = body;
      const updates: any = { updated_at: new Date().toISOString() };
      const fields = ['name', 'server_url', 'xtream_username', 'xtream_password', 'max_connections', 'rep_id', 'active', 'notes'];
      fields.forEach((f: string) => { if (rest[f] !== undefined) updates[f] = rest[f]; });
      const { error } = await supabase.from('sources').update(updates).eq('id', id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'deleteSource') {
      const { id } = body;
      await supabase.from('devices').update({ source_id: null }).eq('source_id', id);
      const { error } = await supabase.from('sources').delete().eq('id', id);
      if (error) throw error;
      return json({ success: true });
    }

    // ── Device actions ────────────────────────────────────────────────────────

    if (action === 'get_devices') {
      const { data: devices, error } = await scopeDevices(
        supabase.from('devices')
          .select('*, plans(id, name, server_url), representatives(rep_number, name)')
          .order('created_at', { ascending: false })
      );
      if (error) throw error;
      return json({ devices });
    }

    if (action === 'activate_device') {
      const { data } = body;
      const { deviceId, planId, expiresAt } = data;
      const now = new Date().toISOString();
      const { error } = await supabase.from('devices').update({
        activated: true, plan_id: planId, activated_at: now, expires_at: expiresAt || null,
        blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now
      }).eq('id', deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'deactivate_device') {
      const { data } = body;
      const { error } = await supabase.from('devices').update({
        activated: false, blocked_reason: null, block_reason_detail: null, updated_at: new Date().toISOString()
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'block_device') {
      const { data } = body;
      const now = new Date().toISOString();
      const { error } = await supabase.from('devices').update({
        activated: false, blocked_reason: 'manual', block_reason_detail: data.reasonDetail || null,
        blocked_at: now, updated_at: now
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'delete_device') {
      const { data } = body;
      const { error } = await supabase.from('devices').delete().eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'delete_devices_bulk') {
      const { data } = body;
      const { deviceIds } = data;
      if (!Array.isArray(deviceIds) || deviceIds.length === 0) throw new Error('Nenhum dispositivo selecionado');
      const { error } = await supabase.from('devices').delete().in('id', deviceIds);
      if (error) throw error;
      return json({ success: true, deleted: deviceIds.length });
    }

    if (action === 'delete_inactive_devices') {
      const { error } = await supabase.from('devices').delete().eq('activated', false).is('blocked_reason', null);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'update_device_notes') {
      const { data } = body;
      const { error } = await supabase.from('devices').update({
        notes: data.notes, updated_at: new Date().toISOString()
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'set_device_expiry') {
      const { data } = body;
      const { error } = await supabase.from('devices').update({
        expires_at: data.expiresAt || null, updated_at: new Date().toISOString()
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'set_device_price') {
      const { data } = body;
      const { error } = await supabase.from('devices').update({
        price: data.price != null ? parseFloat(String(data.price)) : null, updated_at: new Date().toISOString()
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'grant_grace_period') {
      const { data } = body;
      const graceExpiry = new Date();
      graceExpiry.setDate(graceExpiry.getDate() + 3);
      const { error } = await supabase.from('devices').update({
        activated: true, expires_at: graceExpiry.toISOString(),
        blocked_reason: null, block_reason_detail: null, blocked_at: null,
        grace_period_used: true, updated_at: new Date().toISOString()
      }).eq('id', data.deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'get_plans') {
      const { data: plans, error } = await scopePlans(
        supabase.from('plans').select('*').order('created_at', { ascending: false })
      );
      if (error) throw error;
      const plansWithCount = await Promise.all((plans || []).map(async (plan: any) => {
        const { count } = await supabase.from('devices')
          .select('*', { count: 'exact', head: true }).eq('plan_id', plan.id).eq('activated', true);
        return { ...plan, active_macs: count || 0 };
      }));
      return json({ plans: plansWithCount });
    }

    if (action === 'create_plan') {
      const { data } = body;
      const { name, server_url, xtream_username, xtream_password, max_macs, notes } = data;
      const { data: plan, error } = await supabase.from('plans').insert({
        name, server_url, xtream_username, xtream_password,
        max_macs: max_macs || 5, notes: notes || null, admin_id: resolvedAdminId
      }).select().single();
      if (error) throw error;
      return json({ plan });
    }

    if (action === 'update_plan') {
      const { data } = body;
      const { error } = await scopePlans(
        supabase.from('plans').update({ ...data.updates, updated_at: new Date().toISOString() }).eq('id', data.planId)
      );
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'delete_plan') {
      const { data } = body;
      await supabase.from('devices').update({ plan_id: null, activated: false }).eq('plan_id', data.planId);
      const { error } = await scopePlans(
        supabase.from('plans').delete().eq('id', data.planId)
      );
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'get_stats') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const [
        { count: total }, { count: active }, { count: blocked },
        { count: newToday }, { count: online }, { count: plans }, { count: watching }
      ] = await Promise.all([
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true })),
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true }).eq('activated', true)),
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true }).not('blocked_reason', 'is', null)),
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString())),
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true }).gte('last_seen_at', fiveMinAgo)),
        scopePlans(supabase.from('plans').select('*', { count: 'exact', head: true }).eq('active', true)),
        scopeDevices(supabase.from('devices').select('*', { count: 'exact', head: true })
          .not('current_content', 'is', null).gte('current_content_at', thirtyMinAgo)),
      ]);
      return json({
        stats: {
          total: total || 0, active: active || 0,
          pending: (total || 0) - (active || 0) - (blocked || 0),
          blocked: blocked || 0, newToday: newToday || 0,
          online: online || 0, plans: plans || 0, watching: watching || 0
        }
      });
    }

    if (action === 'get_watching_now') {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: watching, error } = await scopeDevices(
        supabase.from('devices')
          .select('id, email, mac_address, device_name, platform, current_content, current_content_type, current_content_at, last_seen_at, client_name, rep_id, admin_id')
          .not('current_content', 'is', null)
          .gte('current_content_at', thirtyMinAgo)
          .order('current_content_at', { ascending: false })
      );
      if (error) throw error;
      return json({ watching: watching || [] });
    }

    if (action === 'send_notification') {
      const { data } = body;
      const { error } = await supabase.from('notifications').insert({
        title: data.title, message: data.message,
        target_email: data.targetEmail || null, target_mac: data.targetMac || null
      });
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'get_notifications') {
      const { data: notifications, error } = await supabase.from('notifications')
        .select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return json({ notifications });
    }

    if (action === 'delete_notification') {
      const { data } = body;
      const { error } = await supabase.from('notifications').delete().eq('id', data.notificationId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'pre_authorize_email') {
      const { data } = body;
      const { email, planId, macAddress } = data;
      if (planId) {
        const { data: planCheck } = await scopePlans(
          supabase.from('plans').select('id').eq('id', planId)
        );
        if (!planCheck?.length) throw new Error('Plano não encontrado ou não pertence a este admin');
      }
      const normalizedEmail = email.toLowerCase().trim();
      const normalizedMac = normalizeMac(macAddress);
      const now = new Date().toISOString();
      const { data: existing } = await supabase.from('devices').select('id').eq('mac_address', normalizedMac).maybeSingle();
      if (existing) {
        await supabase.from('devices').update({
          email: normalizedEmail, plan_id: planId, activated: true, activated_at: now,
          blocked_reason: null, block_reason_detail: null, blocked_at: null,
          updated_at: now, admin_id: resolvedAdminId
        }).eq('mac_address', normalizedMac);
      } else {
        await supabase.from('devices').insert({
          email: normalizedEmail, mac_address: normalizedMac, plan_id: planId,
          activated: true, activated_at: now, device_name: 'Pré-autorizado',
          platform: 'unknown', last_seen_at: now, admin_id: resolvedAdminId
        });
      }
      return json({ success: true });
    }

    return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('admin-api error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Erro interno.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function json(data: object) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function authError() {
  return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
    status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
