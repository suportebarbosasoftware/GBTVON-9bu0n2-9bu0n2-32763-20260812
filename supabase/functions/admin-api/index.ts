// GBTVON admin-api: confirmed mutations, isolated panel queries and request timing.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { issueRootSession, verifyRootSession } from '../_shared/adminSession.ts';
import { readPanelRows, buildPanelOverview, countPanelRelations } from '../_shared/adminPanelData.ts';

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD') ?? '';

function json(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function adminSessionError(message: string, code: string): Response { return json({ error: message, code }, 401); }
function authError(): Response { return adminSessionError('Não autorizado.', 'access_denied'); }
function normalizeMac(mac: string): string {
  const hex = mac.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
  return hex.length === 12 ? hex.match(/.{2}/g)!.join(':') : mac.trim().toUpperCase();
}
function generateSessionToken(): string {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes).map(value => value.toString(16).padStart(2, '0')).join('');
}
async function dataOf(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function confirmedDevice(query: any, representative = false): Promise<Response> {
  const columns = representative ? '*, sources(name)' : '*, plans(id, name, server_url), representatives(rep_number, name)';
  const device = await dataOf(query.select(columns).maybeSingle());
  if (!device) return json({ error: 'Dispositivo não encontrado nesta rede.', code: 'device_not_found' }, 404);
  return json({ success: true, device });
}
async function confirmedDeletion(query: any, required = false): Promise<Response> {
  const rows = await dataOf(query.select('id'));
  if (!Array.isArray(rows)) throw new Error('Não foi possível confirmar a exclusão.');
  if (required && !rows.length) return json({ error: 'Dispositivo não encontrado nesta rede.', code: 'device_not_found' }, 404);
  return json({ success: true, removedIds: rows.map((row: { id: string }) => row.id), deleted: rows.length });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const startedAt = Date.now();
  let actionName = 'unknown';
  try {
    const body = await req.json();
    actionName = typeof body.action === 'string' ? body.action : 'unknown';
    console.log('[panel-edge] start', actionName);
    // Await the complete dispatcher so rejected write confirmations always receive JSON + CORS.
    return await handleBody(body);
  } catch (error: any) {
    console.error('[panel-edge] failed', actionName, error?.code ?? 'internal_error');
    return json({ error: error?.message || 'Erro interno.' }, 500);
  } finally {
    console.log('[panel-edge] end', actionName, 'elapsed_ms', Date.now() - startedAt);
  }
});

async function handleBody(body: any): Promise<Response> {
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { action, adminPassword } = body;

  async function resolveRep(repId: string, password: string): Promise<any | null> {
    if (typeof repId !== 'string' || !repId || typeof password !== 'string' || !password) return null;
    const rep = await dataOf(supabase.from('representatives')
      .select('id, rep_number, name, credits, active, notes, created_at, updated_at, password_hash, admin_id')
      .eq('id', repId).eq('active', true).maybeSingle());
    if (!rep || rep.password_hash !== password) return null;
    const { password_hash: omitted, ...profile } = rep;
    return profile;
  }
  async function planForSource(source: any, adminId: string | null): Promise<string> {
    const query = supabase.from('plans').select('id').eq('server_url', source.server_url)
      .eq('xtream_username', source.xtream_username).eq('xtream_password', source.xtream_password)
      .eq('active', true).order('created_at', { ascending: false }).limit(1);
    const existing = await dataOf((adminId ? query.eq('admin_id', adminId) : query.is('admin_id', null)).maybeSingle());
    if (existing?.id) return existing.id;
    const plan = await dataOf(supabase.from('plans').insert({ name: source.name, server_url: source.server_url,
      xtream_username: source.xtream_username, xtream_password: source.xtream_password,
      max_macs: source.max_connections, admin_id: adminId }).select('id').single());
    if (!plan?.id) throw new Error('Não foi possível preparar a fonte.');
    return plan.id;
  }

  // Public content reporting remains compatible with existing APKs.
  if (action === 'update_current_content') {
    const raw = body.data || body;
    if (!raw.mac_address) return json({ success: false, error: 'mac_address required' });
    const update = { current_content: raw.content || null, current_content_type: raw.content_type || null,
      current_content_at: raw.content ? new Date().toISOString() : null, last_seen_at: new Date().toISOString() };
    let rows = await dataOf(supabase.from('devices').update(update).eq('mac_address', normalizeMac(raw.mac_address)).select('id'));
    if (!rows?.length) rows = await dataOf(supabase.from('devices').update(update).eq('mac_address', raw.mac_address.trim()).select('id'));
    return json({ success: true, updated: rows?.length ?? 0 });
  }
  if (action === 'rootAdminLogin') {
    if (!ADMIN_PASSWORD) return json({ error: 'A senha administrativa não está configurada no servidor.', code: 'admin_not_configured' }, 503);
    if (typeof body.password !== 'string' || !body.password || body.password !== ADMIN_PASSWORD) return adminSessionError('Senha incorreta.', 'invalid_credentials');
    const session = await issueRootSession(ADMIN_PASSWORD);
    return json({ ok: true, rootSessionToken: session.token, expiresAt: session.expiresAt });
  }
  if (action === 'repLogin') {
    if (!body.repNumber || !body.password) return json({ ok: false, error: 'Código e senha obrigatórios' });
    const rep = await dataOf(supabase.from('representatives').select('*').eq('rep_number', body.repNumber).eq('active', true).maybeSingle());
    if (!rep) return json({ ok: false, error: 'Representante não encontrado' });
    if (rep.password_hash !== body.password) return json({ ok: false, error: 'Senha incorreta' });
    const { password_hash: omitted, ...profile } = rep;
    return json({ ok: true, rep: profile });
  }
  if (action === 'validateRepCode') {
    if (!body.repNumber) return json({ ok: false });
    const rep = await dataOf(supabase.from('representatives').select('id, name, rep_number').eq('rep_number', body.repNumber).eq('active', true).maybeSingle());
    return rep ? json({ ok: true, repId: rep.id, repName: rep.name }) : json({ ok: false, error: 'Código de representante não encontrado' });
  }
  if (action === 'subAdminLogin') {
    if (!body.username || !body.password) return json({ ok: false, error: 'Usuário e senha obrigatórios' });
    const adm = await dataOf(supabase.from('admins').select('*').eq('username', body.username.trim().toLowerCase())
      .eq('active', true).not('parent_id', 'is', null).maybeSingle());
    if (!adm) return json({ ok: false, error: 'Sub-admin não encontrado' });
    if (adm.password_hash !== body.password) return json({ ok: false, error: 'Senha incorreta' });
    const token = generateSessionToken();
    await dataOf(supabase.from('admins').update({ session_token: token,
      session_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }).eq('id', adm.id));
    return json({ ok: true, admin: { id: adm.id, name: adm.name, username: adm.username, parent_id: adm.parent_id }, sessionToken: token });
  }

  // Representative requests do not depend on an administrative session.
  const repActions = new Set(['getRepPanelSnapshot', 'getRepDevices', 'getRepSources', 'activateRepDevice', 'activateRepTest',
    'deactivateRepDevice', 'blockRepDevice', 'unblockRepDevice', 'deleteRepDevice', 'renewRepDevice',
    'changeRepDeviceSource', 'updateRepDevicePrice', 'lookupDeviceByMac']);
  if (repActions.has(action)) {
    const { repId, repPassword, deviceId } = body;
    // Prepare source/device queries in parallel with authentication for source switching.
    if (action === 'changeRepDeviceSource') {
      if (!deviceId || !body.sourceId) throw new Error('Dados incompletos');
      const [rep, deviceResult, sourceResult] = await Promise.all([
        resolveRep(repId, repPassword),
        supabase.from('devices').select('id').eq('id', deviceId).eq('rep_id', repId).maybeSingle(),
        supabase.from('sources').select('*').eq('id', body.sourceId).eq('rep_id', repId).eq('active', true).maybeSingle(),
      ]);
      if (!rep) return authError();
      if (deviceResult.error) throw deviceResult.error;
      if (sourceResult.error) throw sourceResult.error;
      if (!deviceResult.data) return json({ error: 'Dispositivo não encontrado na sua rede', code: 'device_not_found' }, 404);
      const source = sourceResult.data;
      if (!source || (source.admin_id ?? null) !== (rep.admin_id ?? null)) throw new Error('Fonte não encontrada ou fora da rede deste representante');
      const planId = await planForSource(source, rep.admin_id ?? null);
      return confirmedDevice(supabase.from('devices').update({ source_id: body.sourceId, plan_id: planId,
        updated_at: new Date().toISOString() }).eq('id', deviceId).eq('rep_id', repId), true);
    }
    const rep = await resolveRep(repId, repPassword);
    if (!rep) return authError();
    if (action === 'getRepPanelSnapshot' || action === 'getRepDevices') {
      const devices = await readPanelRows(() => supabase.from('devices').select('*, sources(name)').eq('rep_id', repId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }));
      return json({ devices, rep, syncedAt: new Date().toISOString() });
    }
    if (action === 'getRepSources') {
      const sources = await readPanelRows(() => supabase.from('sources').select('*').eq('rep_id', repId).eq('active', true).order('id'));
      if (!sources.length) return json({ sources: [] });
      const rows = await readPanelRows(() => supabase.from('devices').select('id, source_id').eq('rep_id', repId)
        .eq('activated', true).in('source_id', sources.map(source => source.id)).order('id'));
      const counts = countPanelRelations(rows, 'source_id');
      return json({ sources: sources.map(source => ({ ...source, active_macs: counts.get(source.id) ?? 0 })) });
    }
    if (action === 'lookupDeviceByMac') {
      if (!body.mac) return json({ found: false });
      const device = await dataOf(supabase.from('devices').select('client_name, email, mac_address')
        .eq('mac_address', normalizeMac(body.mac)).maybeSingle());
      return device ? json({ found: true, client_name: device.client_name || '', email: device.email || '' }) : json({ found: false });
    }
    if (action === 'activateRepDevice' || action === 'activateRepTest') {
      if (!body.mac || !body.sourceId) throw new Error('Dados incompletos');
      const test = action === 'activateRepTest';
      const period = Number(test ? body.hours : body.days);
      if (!Number.isInteger(period) || period < 1 || (test && period > 6)) throw new Error('Prazo inválido');
      const cost = test ? 0 : Math.round((period / 30) * 100) / 100;
      if (Number(rep.credits) < cost) throw new Error(`Créditos insuficientes. Esta ativação custa ${cost.toFixed(2)}.`);
      const mac = normalizeMac(body.mac);
      const [source, existing] = await Promise.all([
        dataOf(supabase.from('sources').select('*').eq('id', body.sourceId).eq('rep_id', repId).eq('active', true).maybeSingle()),
        dataOf(supabase.from('devices').select('id, admin_id').eq('mac_address', mac).maybeSingle()),
      ]);
      if (!source || (source.admin_id ?? null) !== (rep.admin_id ?? null)) throw new Error('Fonte não encontrada nesta rede');
      if (existing && (existing.admin_id ?? null) !== (rep.admin_id ?? null)) throw new Error('MAC já associado a outra rede');
      const planId = await planForSource(source, rep.admin_id ?? null);
      const now = new Date().toISOString();
      const expiry = test ? new Date(Date.now() + period * 3600000)
        : body.expiresAtDate ? new Date(body.expiresAtDate) : new Date(Date.now() + period * 86400000);
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('Vencimento inválido');
      const email = body.email ? body.email.toLowerCase().trim() : `mac_${mac.replace(/:/g, '').toLowerCase()}@gbtvon.local`;
      const values = { email, client_name: body.clientName || null, plan_id: planId, source_id: body.sourceId,
        package_type: body.packageType || 'iptv', rep_id: repId, admin_id: rep.admin_id ?? null,
        activated: true, activated_at: now, expires_at: expiry.toISOString(), blocked_reason: null,
        block_reason_detail: null, blocked_at: null, updated_at: now };
      if (existing) await dataOf(supabase.from('devices').update(values).eq('id', existing.id));
      else await dataOf(supabase.from('devices').insert({ ...values, mac_address: mac,
        device_name: test ? 'Teste gratuito' : 'Ativado pelo representante', platform: 'unknown', last_seen_at: now }));
      if (!test) await dataOf(supabase.from('representatives').update({ credits: Number(rep.credits) - cost, updated_at: now }).eq('id', repId));
      await dataOf(supabase.from('credit_transactions').insert({ rep_id: repId, amount: Math.ceil(cost), type: 'consume',
        description: test ? `Teste ${period}h — ${mac}` : `Ativação ${period}d ${body.packageType?.toUpperCase()} — ${mac} (custo real: ${cost.toFixed(2)} cr.)`,
        device_mac: mac, days: test ? 0 : period }));
      return json({ success: true, credit_cost: cost });
    }
    if (action === 'deleteRepDevice') return confirmedDeletion(supabase.from('devices').delete().eq('id', deviceId).eq('rep_id', repId), true);
    if (action === 'renewRepDevice') {
      const days = Number(body.days);
      if (!deviceId || !Number.isInteger(days) || days < 1) throw new Error('Prazo inválido');
      const cost = Math.round((days / 30) * 100) / 100;
      if (Number(rep.credits) < cost) throw new Error(`Créditos insuficientes. Esta renovação custa ${cost.toFixed(2)}.`);
      const device = await dataOf(supabase.from('devices').select('id, expires_at, mac_address').eq('id', deviceId).eq('rep_id', repId).maybeSingle());
      if (!device) throw new Error('Dispositivo não encontrado na sua rede');
      const expiry = device.expires_at && new Date(device.expires_at).getTime() > Date.now() ? new Date(device.expires_at) : new Date();
      expiry.setDate(expiry.getDate() + days);
      const now = new Date().toISOString();
      await dataOf(supabase.from('devices').update({ expires_at: expiry.toISOString(), activated: true,
        blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now }).eq('id', deviceId).eq('rep_id', repId));
      await dataOf(supabase.from('representatives').update({ credits: Number(rep.credits) - cost, updated_at: now }).eq('id', repId));
      await dataOf(supabase.from('credit_transactions').insert({ rep_id: repId, amount: Math.ceil(cost), type: 'consume',
        description: `Renovação ${days}d — ${device.mac_address} (custo real: ${cost.toFixed(2)} cr.)`, device_mac: device.mac_address, days }));
      return json({ success: true, new_expiry: expiry.toISOString(), credit_cost: cost });
    }
    const now = new Date().toISOString();
    let updates: Record<string, any>;
    if (action === 'blockRepDevice') updates = { activated: false, blocked_reason: 'manual',
      block_reason_detail: body.reason || 'Bloqueado pelo representante', blocked_at: now,
      current_content: null, current_content_type: null, current_content_at: null };
    else if (action === 'deactivateRepDevice') updates = { activated: false, current_content: null, current_content_type: null, current_content_at: null };
    else if (action === 'unblockRepDevice') updates = { activated: true, blocked_reason: null, block_reason_detail: null, blocked_at: null };
    else if (action === 'updateRepDevicePrice') {
      const price = body.price != null ? Number(body.price) : null;
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Valor inválido');
      updates = { price };
    } else return json({ error: 'Ação de representante desconhecida' }, 400);
    return confirmedDevice(supabase.from('devices').update({ ...updates, updated_at: now }).eq('id', deviceId).eq('rep_id', repId), true);
  }

  // A partial sub-admin identity cannot fall back to root. Root legacy APKs stay supported.
  const { adminId, sessionToken, rootSessionToken } = body;
  let resolvedAdminId: string | null = null;
  if (adminId !== undefined || sessionToken !== undefined) {
    if (!adminId || !sessionToken || rootSessionToken !== undefined) return adminSessionError('Sessão administrativa incompleta. Faça login novamente.', 'session_invalid');
    const adm = await dataOf(supabase.from('admins').select('id, parent_id, active, session_expires_at').eq('id', adminId)
      .eq('session_token', sessionToken).eq('active', true).not('parent_id', 'is', null).maybeSingle());
    if (!adm) return adminSessionError('Sessão inválida. Faça login novamente.', 'session_invalid');
    const expiry = adm.session_expires_at ? new Date(adm.session_expires_at).getTime() : NaN;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return adminSessionError('Sessão expirada. Faça login novamente.', 'session_expired');
    resolvedAdminId = adm.id;
  } else if (rootSessionToken !== undefined) {
    if (!await verifyRootSession(rootSessionToken, ADMIN_PASSWORD)) return adminSessionError('Sessão administrativa inválida ou expirada. Faça login novamente.', 'session_expired');
  } else if (!ADMIN_PASSWORD || typeof adminPassword !== 'string' || !adminPassword || adminPassword !== ADMIN_PASSWORD) {
    return adminSessionError(adminPassword ? 'Senha incorreta.' : 'Sessão administrativa ausente. Faça login novamente.', adminPassword ? 'invalid_credentials' : 'session_missing');
  }
  function scope(query: any): any { return resolvedAdminId ? query.eq('admin_id', resolvedAdminId) : query.is('admin_id', null); }
  const scopeDevices = scope;
  const scopeReps = scope;
  const scopeSources = scope;
  const scopePlans = scope;
  const deviceColumns = '*, plans(id, name, server_url), representatives(rep_number, name)';
  async function panelDevices(): Promise<any[]> {
    return readPanelRows(() => scopeDevices(supabase.from('devices').select(deviceColumns)
      .order('created_at', { ascending: false }).order('id', { ascending: false })));
  }
  if (action === 'get_panel_snapshot' || action === 'get_stats') {
    const [devices, planResult] = await Promise.all([panelDevices(), scopePlans(supabase.from('plans').select('id', { count: 'exact', head: true }).eq('active', true))]);
    if (planResult.error) throw planResult.error;
    const overview = buildPanelOverview(devices, planResult.count ?? 0);
    return action === 'get_stats' ? json({ stats: overview.stats }) : json({ devices, ...overview });
  }
  if (action === 'get_devices') return json({ devices: await panelDevices() });
  if (action === 'get_watching_now') {
    const watching = await dataOf(scopeDevices(supabase.from('devices')
      .select('id, email, mac_address, device_name, platform, current_content, current_content_type, current_content_at, last_seen_at, client_name, rep_id, admin_id')
      .not('current_content', 'is', null).gte('current_content_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('current_content_at', { ascending: false })));
    return json({ watching: watching || [] });
  }

  if (['getSubAdmins', 'createSubAdmin', 'updateSubAdmin', 'deleteSubAdmin'].includes(action)) {
    if (resolvedAdminId) return json({ error: 'Apenas o admin root pode gerenciar sub-admins.' }, 403);
    if (action === 'getSubAdmins') return json({ admins: await dataOf(supabase.from('admins')
      .select('id, username, name, active, notes, created_at, parent_id').not('parent_id', 'is', null).order('created_at', { ascending: true })) || [] });
    if (action === 'createSubAdmin') {
      if (!body.username || !body.password || !body.name) throw new Error('Usuário, senha e nome obrigatórios');
      let root = await dataOf(supabase.from('admins').select('id').is('parent_id', null).limit(1).maybeSingle());
      if (!root) root = await dataOf(supabase.from('admins').insert({ username: 'root', password_hash: ADMIN_PASSWORD,
        name: 'Admin Principal', parent_id: null }).select('id').single());
      const admin = await dataOf(supabase.from('admins').insert({ username: body.username.trim().toLowerCase(), password_hash: body.password,
        name: body.name.trim(), parent_id: root.id, notes: body.notes || null }).select().single());
      return json({ admin });
    }
    if (action === 'updateSubAdmin') {
      const updates: any = { updated_at: new Date().toISOString() };
      if (body.name) updates.name = body.name;
      if (body.password) { updates.password_hash = body.password; updates.session_token = null; updates.session_expires_at = null; }
      if (body.active !== undefined) updates.active = body.active;
      if (body.notes !== undefined) updates.notes = body.notes;
      await dataOf(supabase.from('admins').update(updates).eq('id', body.id).not('parent_id', 'is', null));
      return json({ success: true });
    }
    await Promise.all(['representatives', 'sources', 'devices', 'plans'].map(table =>
      dataOf(supabase.from(table).update({ admin_id: null }).eq('admin_id', body.id))));
    await dataOf(supabase.from('admins').delete().eq('id', body.id).not('parent_id', 'is', null));
    return json({ success: true });
  }

  if (action === 'getRepresentatives') {
    const reps = await dataOf(scopeReps(supabase.from('representatives').select('*').order('rep_number', { ascending: true })));
    if (!reps?.length) return json({ representatives: [] });
    const ids = reps.map((rep: any) => rep.id);
    const [active, consumed] = await Promise.all([
      readPanelRows(() => scopeDevices(supabase.from('devices').select('id, rep_id').in('rep_id', ids).eq('activated', true).order('id'))),
      readPanelRows(() => supabase.from('credit_transactions').select('id, rep_id, amount').in('rep_id', ids).eq('type', 'consume').order('id')),
    ]);
    const counts = countPanelRelations(active, 'rep_id');
    const totals = new Map<string, number>();
    for (const row of consumed) totals.set(row.rep_id, (totals.get(row.rep_id) ?? 0) + Number(row.amount));
    return json({ representatives: reps.map((rep: any) => ({ ...rep, active_devices: counts.get(rep.id) ?? 0, total_consumed: totals.get(rep.id) ?? 0 })) });
  }
  if (action === 'createRepresentative') {
    if (!body.name || !body.rep_number || !body.password) throw new Error('Nome, número e senha obrigatórios');
    const representative = await dataOf(supabase.from('representatives').insert({ name: body.name, rep_number: body.rep_number,
      password_hash: body.password, credits: body.credits || 0, notes: body.notes || null, admin_id: resolvedAdminId }).select().single());
    return json({ representative });
  }
  if (action === 'updateRepresentative') {
    const updates: any = { updated_at: new Date().toISOString() };
    for (const field of ['name', 'active', 'notes']) if (body[field] !== undefined) updates[field] = body[field];
    if (body.password) updates.password_hash = body.password;
    await dataOf(scopeReps(supabase.from('representatives').update(updates).eq('id', body.id)));
    return json({ success: true });
  }
  if (action === 'deleteRepresentative') {
    const rep = await dataOf(scopeReps(supabase.from('representatives').select('id').eq('id', body.id)).maybeSingle());
    if (!rep) throw new Error('Representante não encontrado nesta rede');
    await Promise.all([dataOf(scopeDevices(supabase.from('devices').update({ rep_id: null }).eq('rep_id', body.id))),
      dataOf(scopeSources(supabase.from('sources').update({ rep_id: null }).eq('rep_id', body.id)))]);
    await dataOf(scopeReps(supabase.from('representatives').delete().eq('id', body.id)));
    return json({ success: true });
  }
  if (action === 'addCredits' || action === 'removeCredits') {
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1) throw new Error('Quantidade inválida');
    const rep = await dataOf(scopeReps(supabase.from('representatives').select('credits').eq('id', body.repId)).maybeSingle());
    if (!rep) throw new Error('Representante não encontrado');
    const adding = action === 'addCredits';
    const balance = adding ? Number(rep.credits) + amount : Math.max(0, Number(rep.credits) - amount);
    await dataOf(scopeReps(supabase.from('representatives').update({ credits: balance, updated_at: new Date().toISOString() }).eq('id', body.repId)));
    await dataOf(supabase.from('credit_transactions').insert({ rep_id: body.repId, amount: adding ? amount : -amount,
      type: adding ? 'add' : 'consume', description: body.description || (adding ? 'Créditos adicionados pelo admin' : 'Créditos removidos pelo admin') }));
    return json({ success: true, new_balance: balance });
  }
  if (action === 'getCreditTransactions') {
    const rep = await dataOf(scopeReps(supabase.from('representatives').select('id').eq('id', body.repId)).maybeSingle());
    if (!rep) throw new Error('Representante não encontrado nesta rede');
    return json({ transactions: await dataOf(supabase.from('credit_transactions').select('*').eq('rep_id', body.repId)
      .order('created_at', { ascending: false }).limit(50)) || [] });
  }

  if (action === 'getSources' || action === 'get_plans') {
    const plans = action === 'get_plans';
    const table = plans ? 'plans' : 'sources';
    const rows = await dataOf(scope(supabase.from(table).select(plans ? '*' : '*, representatives(name)').order('created_at', { ascending: false })));
    if (!rows?.length) return json({ [plans ? 'plans' : 'sources']: [] });
    const field = plans ? 'plan_id' : 'source_id';
    const active = await readPanelRows(() => scopeDevices(supabase.from('devices').select(`id, ${field}`)
      .eq('activated', true).in(field, rows.map((row: any) => row.id)).order('id')));
    const counts = countPanelRelations(active, field);
    const results = rows.map((row: any) => ({ ...row, active_macs: counts.get(row.id) ?? 0,
      ...(plans ? {} : { rep_name: row.representatives?.name }) }));
    return json({ [plans ? 'plans' : 'sources']: results });
  }
  if (action === 'createSource' || action === 'create_plan') {
    const plans = action === 'create_plan';
    const raw = plans ? body.data : body;
    if (!raw.name || !raw.server_url || !raw.xtream_username || !raw.xtream_password) throw new Error('Campos obrigatórios faltando');
    const values: any = { name: raw.name, server_url: raw.server_url, xtream_username: raw.xtream_username,
      xtream_password: raw.xtream_password, notes: raw.notes || null, admin_id: resolvedAdminId };
    if (plans) values.max_macs = raw.max_macs || 5;
    else { values.max_connections = raw.max_connections || 5; values.rep_id = raw.rep_id || null; }
    const result = await dataOf(supabase.from(plans ? 'plans' : 'sources').insert(values).select().single());
    return json({ [plans ? 'plan' : 'source']: result });
  }
  if (action === 'updateSource' || action === 'update_plan') {
    const plans = action === 'update_plan';
    const raw = plans ? body.data.updates : body;
    const updates: any = { updated_at: new Date().toISOString() };
    const fields = plans ? ['name', 'server_url', 'xtream_username', 'xtream_password', 'max_macs', 'active', 'notes']
      : ['name', 'server_url', 'xtream_username', 'xtream_password', 'max_connections', 'rep_id', 'active', 'notes'];
    for (const field of fields) if (raw[field] !== undefined) updates[field] = raw[field];
    await dataOf(scope(supabase.from(plans ? 'plans' : 'sources').update(updates).eq('id', plans ? body.data.planId : body.id)));
    return json({ success: true });
  }
  if (action === 'deleteSource' || action === 'delete_plan') {
    const plans = action === 'delete_plan';
    const id = plans ? body.data.planId : body.id;
    const row = await dataOf(scope(supabase.from(plans ? 'plans' : 'sources').select('id').eq('id', id)).maybeSingle());
    if (!row) throw new Error('Registro não encontrado nesta rede');
    await dataOf(scopeDevices(supabase.from('devices').update(plans ? { plan_id: null, activated: false } : { source_id: null }).eq(plans ? 'plan_id' : 'source_id', id)));
    await dataOf(scope(supabase.from(plans ? 'plans' : 'sources').delete().eq('id', id)));
    return json({ success: true });
  }

  const raw = body.data || {};
  if (action === 'delete_device') return confirmedDeletion(scopeDevices(supabase.from('devices').delete().eq('id', raw.deviceId)), true);
  if (action === 'delete_devices_bulk') {
    if (!Array.isArray(raw.deviceIds) || !raw.deviceIds.length) throw new Error('Nenhum dispositivo selecionado');
    return confirmedDeletion(scopeDevices(supabase.from('devices').delete().in('id', raw.deviceIds)));
  }
  if (action === 'delete_inactive_devices') return confirmedDeletion(scopeDevices(supabase.from('devices').delete().eq('activated', false).is('blocked_reason', null)));
  const deviceActions = new Set(['save_device', 'activate_device', 'deactivate_device', 'block_device',
    'update_device_notes', 'set_device_expiry', 'set_device_price', 'grant_grace_period']);
  if (deviceActions.has(action)) {
    if (!raw.deviceId) throw new Error('Dispositivo obrigatório');
    const now = new Date().toISOString();
    let updates: any = { updated_at: now };
    if (action === 'save_device' || action === 'activate_device') {
      if (!raw.planId) throw new Error('Plano obrigatório');
      const plan = await dataOf(scopePlans(supabase.from('plans').select('id').eq('id', raw.planId)).maybeSingle());
      if (!plan) throw new Error('Plano não encontrado nesta rede');
      if (raw.expiresAt && !Number.isFinite(new Date(raw.expiresAt).getTime())) throw new Error('Vencimento inválido');
      updates = { ...updates, activated: true, plan_id: raw.planId, activated_at: now, expires_at: raw.expiresAt || null,
        blocked_reason: null, block_reason_detail: null, blocked_at: null };
      if (action === 'save_device') {
        if (raw.price != null && (!Number.isFinite(Number(raw.price)) || Number(raw.price) < 0)) throw new Error('Valor inválido');
        updates.notes = typeof raw.notes === 'string' ? raw.notes : null;
        updates.price = raw.price != null ? Number(raw.price) : null;
      }
    } else if (action === 'block_device' || action === 'deactivate_device') {
      updates = { ...updates, activated: false, blocked_reason: action === 'block_device' ? 'manual' : null,
        block_reason_detail: action === 'block_device' ? raw.reasonDetail || null : null,
        current_content: null, current_content_type: null, current_content_at: null };
      if (action === 'block_device') updates.blocked_at = now;
    } else if (action === 'update_device_notes') updates.notes = raw.notes;
    else if (action === 'set_device_expiry') {
      if (raw.expiresAt && !Number.isFinite(new Date(raw.expiresAt).getTime())) throw new Error('Vencimento inválido');
      updates.expires_at = raw.expiresAt || null;
    } else if (action === 'set_device_price') {
      if (raw.price != null && (!Number.isFinite(Number(raw.price)) || Number(raw.price) < 0)) throw new Error('Valor inválido');
      updates.price = raw.price != null ? Number(raw.price) : null;
    } else {
      updates = { ...updates, activated: true, expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        blocked_reason: null, block_reason_detail: null, blocked_at: null, grace_period_used: true };
    }
    return confirmedDevice(scopeDevices(supabase.from('devices').update(updates).eq('id', raw.deviceId)));
  }

  if (action === 'send_notification') {
    await dataOf(supabase.from('notifications').insert({ title: raw.title, message: raw.message,
      target_email: raw.targetEmail || null, target_mac: raw.targetMac || null }));
    return json({ success: true });
  }
  if (action === 'get_notifications') return json({ notifications: await dataOf(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) });
  if (action === 'delete_notification') {
    await dataOf(supabase.from('notifications').delete().eq('id', raw.notificationId));
    return json({ success: true });
  }
  if (action === 'pre_authorize_email') {
    if (raw.planId) {
      const plan = await dataOf(scopePlans(supabase.from('plans').select('id').eq('id', raw.planId)).maybeSingle());
      if (!plan) throw new Error('Plano não encontrado ou não pertence a este admin');
    }
    const mac = normalizeMac(raw.macAddress);
    const now = new Date().toISOString();
    const existing = await dataOf(supabase.from('devices').select('id, admin_id').eq('mac_address', mac).maybeSingle());
    if (existing && (existing.admin_id ?? null) !== resolvedAdminId) throw new Error('MAC já associado a outra rede');
    const values = { email: raw.email.toLowerCase().trim(), plan_id: raw.planId, activated: true, activated_at: now,
      blocked_reason: null, block_reason_detail: null, blocked_at: null, updated_at: now, admin_id: resolvedAdminId };
    if (existing) await dataOf(scopeDevices(supabase.from('devices').update(values).eq('id', existing.id)));
    else await dataOf(supabase.from('devices').insert({ ...values, mac_address: mac, device_name: 'Pré-autorizado', platform: 'unknown', last_seen_at: now }));
    return json({ success: true });
  }
  return json({ error: `Ação desconhecida: ${action}` }, 400);
}
