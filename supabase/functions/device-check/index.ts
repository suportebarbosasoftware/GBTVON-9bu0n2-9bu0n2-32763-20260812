// device-check Edge Function — GBTVON
// Registers a device and returns activation status + credentials if active
// MAC is the primary identifier — email is optional (auto-generated from MAC if not provided)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

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
    const { email, mac_address, device_name, platform, mark_grace_period, rep_code, client_name } = body;

    if (!mac_address) {
      return new Response(JSON.stringify({ error: 'MAC é obrigatório.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Generate a synthetic email from MAC if none provided
    const normalizedEmail = email
      ? email.toLowerCase().trim()
      : `mac_${mac_address.replace(/:/g, '').toLowerCase()}@gbtvon.local`;

    const now = new Date().toISOString();

    // Resolve rep_id from rep_code if provided
    let repId: string | null = null;
    if (rep_code) {
      const { data: rep } = await supabase
        .from('representatives')
        .select('id')
        .eq('rep_number', rep_code.trim())
        .eq('active', true)
        .maybeSingle();
      if (rep) repId = rep.id;
    }

    // Normalize MAC: uppercase + colon format for consistent comparison
    const normalizedMac = mac_address.trim().toUpperCase().replace(/[^A-F0-9]/g, '').replace(/(.{2})/g, '$1:').replace(/:$/, '');

    // ── Check by MAC address ──────────────────────────────────────
    // Use separate queries instead of join to avoid slow PostgREST embed resolution
    const { data: existing } = await supabase
      .from('devices')
      .select('*')
      .eq('mac_address', normalizedMac)
      .maybeSingle();

    if (existing) {
      // Always update last_seen_at; link rep_id and client_name if provided
      const updateData: any = { last_seen_at: now };
      if (existing.email !== normalizedEmail) updateData.email = normalizedEmail;
      if (repId && !existing.rep_id) updateData.rep_id = repId;
      if (client_name && client_name.trim() && !existing.client_name) {
        updateData.client_name = client_name.trim();
      }
      await supabase.from('devices').update(updateData).eq('mac_address', normalizedMac);

      // ── MANUALLY BLOCKED ──────────────────────────────────────
      if (existing.blocked_reason === 'manual') {
        return new Response(JSON.stringify({
          status: 'blocked_manual',
          message: existing.block_reason_detail || 'Acesso bloqueado pelo administrador. Entre em contato com o suporte.',
          block_reason_detail: existing.block_reason_detail || null,
          mac_address,
          email: normalizedEmail,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── ACTIVATED — via plan OR via representative source ────────
      const isActivated = existing.activated && (existing.source_id || existing.plan_id);
      if (isActivated) {
        // Check if MAC has expired
        if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
          await supabase.from('devices').update({
            activated: false,
            blocked_reason: 'expired',
            blocked_at: now,
          }).eq('mac_address', normalizedMac);

          return new Response(JSON.stringify({
            status: 'expired',
            grace_period_used: existing.grace_period_used || false,
            price: existing.price || null,
            message: 'Assinatura expirada.',
            mac_address: normalizedMac,
            email: normalizedEmail,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Resolve credentials: source_id takes priority over plan_id
        let credSource: any = null;
        let planLabel = 'Plano';

        if (existing.source_id) {
          const { data: src } = await supabase.from('sources').select('*').eq('id', existing.source_id).maybeSingle();
          if (src) { credSource = src; planLabel = src.name; }
        }
        if (!credSource && existing.plan_id) {
          const { data: plan } = await supabase.from('plans').select('*').eq('id', existing.plan_id).maybeSingle();
          if (plan) { credSource = plan; planLabel = plan.name; }
        }

        if (!credSource) {
          // Activated but credentials missing (plan/source deleted)
          return new Response(JSON.stringify({
            status: 'pending',
            message: 'Plano ou fonte não encontrado. Entre em contato com o suporte.',
            mac_address: normalizedMac,
            email: normalizedEmail,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Fetch notifications
        const { data: notifications } = await supabase
          .from('notifications')
          .select('id, title, message, created_at')
          .or(`target_email.is.null,target_email.eq.${normalizedEmail}`)
          .order('created_at', { ascending: false })
          .limit(10);

        return new Response(JSON.stringify({
          status: 'activated',
          credentials: {
            server: credSource.server_url,
            username: credSource.xtream_username,
            password: credSource.xtream_password,
          },
          plan_name: planLabel,
          expires_at: existing.expires_at,
          mac_address: normalizedMac,
          email: normalizedEmail,
          grace_period_used: existing.grace_period_used || false,
          price: existing.price || null,
          notifications: notifications || [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── EXPIRED (already flagged) ─────────────────────────────
      if (existing.blocked_reason === 'expired') {
        if (mark_grace_period && !existing.grace_period_used) {
          const graceExpiry = new Date();
          graceExpiry.setDate(graceExpiry.getDate() + 3);
          await supabase.from('devices').update({
            activated: true,
            expires_at: graceExpiry.toISOString(),
            blocked_reason: null,
            block_reason_detail: null,
            blocked_at: null,
            grace_period_used: true,
            updated_at: now,
          }).eq('mac_address', normalizedMac);

          // Re-fetch credentials after grace
          const { data: renewed } = await supabase.from('devices').select('*').eq('mac_address', normalizedMac).maybeSingle();
          let graceCred: any = null;
          if (renewed?.source_id) {
            const { data: src } = await supabase.from('sources').select('*').eq('id', renewed.source_id).maybeSingle();
            if (src) graceCred = src;
          }
          if (!graceCred && renewed?.plan_id) {
            const { data: plan } = await supabase.from('plans').select('*').eq('id', renewed.plan_id).maybeSingle();
            if (plan) graceCred = plan;
          }
          if (graceCred) {
            return new Response(JSON.stringify({
              status: 'activated',
              credentials: {
                server: graceCred.server_url,
                username: graceCred.xtream_username,
                password: graceCred.xtream_password,
              },
              plan_name: graceCred.name ?? 'Plano',
              expires_at: renewed?.expires_at,
              grace_period_used: true,
              mac_address: normalizedMac,
              email: normalizedEmail,
              notifications: [],
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        return new Response(JSON.stringify({
          status: 'expired',
          grace_period_used: existing.grace_period_used || false,
          price: existing.price || null,
          message: 'Assinatura expirada.',
          mac_address: normalizedMac,
          email: normalizedEmail,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── NOT ACTIVATED (pending) ───────────────────────────────
      return new Response(JSON.stringify({
        status: 'pending',
        message: 'Aguardando ativação pelo administrador.',
        mac_address: normalizedMac,
        email: normalizedEmail,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── NEW DEVICE — register ─────────────────────────────────
    const insertData: any = {
      email: normalizedEmail,
      mac_address: normalizedMac,
      device_name: device_name || 'Dispositivo',
      platform: platform || 'unknown',
      activated: false,
      last_seen_at: now,
    };
    if (repId) insertData.rep_id = repId;
    if (client_name && client_name.trim()) insertData.client_name = client_name.trim();

    const { error: insertError } = await supabase.from('devices').insert(insertData);

    if (insertError) {
      console.error('Insert error:', insertError);
      // May already exist due to race — try to fetch
      const { data: raceExisting } = await supabase.from('devices').select('*').eq('mac_address', normalizedMac).maybeSingle();
      if (raceExisting) {
        return new Response(JSON.stringify({
          status: 'pending',
          message: 'Aguardando ativação pelo administrador.',
          mac_address: normalizedMac,
          email: normalizedEmail,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Erro ao registrar dispositivo.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      status: 'pending',
      message: 'Dispositivo registrado! Aguardando ativação pelo administrador.',
      mac_address: normalizedMac,
      email: normalizedEmail,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('device-check error:', err);
    return new Response(JSON.stringify({ error: `Erro interno: ${err.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
