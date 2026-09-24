import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: admin } = await adminClient.from('profiles').select('id').eq('id', caller.id).eq('role', 'admin').eq('status', 'active').single();
    if (!admin) return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });

    const { user_id: userId } = await request.json();
    if (!userId) return new Response(JSON.stringify({ error: 'User id is required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (userId === caller.id) return new Response(JSON.stringify({ error: 'You cannot delete your own admin account' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
    return new Response(JSON.stringify({ error: message || 'Unexpected error' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
