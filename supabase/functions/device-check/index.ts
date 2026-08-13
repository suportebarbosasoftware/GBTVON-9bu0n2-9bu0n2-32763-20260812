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

    // ── Check by MAC address ──────────────────────────────────────
    const { data: existing } = await supabase
      .from('devices')
      .select('*, plans(*), sources(*)')
      .eq('mac_address', mac_address)
      .maybeSingle();

    if (existing) {
      // Always update last_seen_at; link rep_id and client_name if provided
      const updateData: any = { last_seen_at: now };
      if (existing.email !== normalizedEmail) updateData.email = normalizedEmail;
      if (repId && !existing.rep_id) updateData.rep_id = repId;
      if (client_name && client_name.trim() && !existing.client_name) {
        updateData.client_name = client_name.trim();
      }
      await supabase.from('devices').update(updateData).eq('mac_address', mac_address);

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
      const hasCredentials = existing.activated && (existing.plans || existing.sources);
      if (hasCredentials) {
        // Check if MAC has expired
        if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
          await supabase.from('devices').update({
            activated: false,
            blocked_reason: 'expired',
            blocked_at: now,
          }).eq('mac_address', mac_address);

          return new Response(JSON.stringify({
            status: 'expired',
            grace_period_used: existing.grace_period_used || false,
            price: existing.price || null,
            message: 'Assinatura expirada.',
            mac_address,
            email: normalizedEmail,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Resolve credentials: source takes priority over plan
        const credSource = existing.sources || existing.plans;
        const planLabel = existing.sources
          ? existing.sources.name
          : existing.plans?.name ?? 'Plano';

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
          mac_address,
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
          }).eq('mac_address', mac_address);

          const { data: renewed } = await supabase
            .from('devices')
            .select('*, plans(*), sources(*)')
            .eq('mac_address', mac_address)
            .maybeSingle();

          const renewedCred = renewed?.sources || renewed?.plans;
          if (renewedCred) {
            return new Response(JSON.stringify({
              status: 'activated',
              credentials: {
                server: renewedCred.server_url,
                username: renewedCred.xtream_username,
                password: renewedCred.xtream_password,
              },
              plan_name: renewed?.sources?.name ?? renewed?.plans?.name ?? 'Plano',
              expires_at: renewed?.expires_at,
              grace_period_used: true,
              mac_address,
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
          mac_address,
          email: normalizedEmail,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── NOT ACTIVATED (pending) ───────────────────────────────
      return new Response(JSON.stringify({
        status: 'pending',
        message: 'Aguardando ativação pelo administrador.',
        mac_address,
        email: normalizedEmail,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── NEW DEVICE — register ─────────────────────────────────
    const insertData: any = {
      email: normalizedEmail,
      mac_address,
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
      return new Response(JSON.stringify({ error: 'Erro ao registrar dispositivo.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      status: 'pending',
      message: 'Dispositivo registrado! Aguardando ativação pelo administrador.',
      mac_address,
      email: normalizedEmail,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('device-check error:', err);
    return new Response(JSON.stringify({ error: `Erro interno: ${err.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
