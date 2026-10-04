// Shared helpers for Nomiqo edge functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Wraps a handler with CORS preflight, POST-only and error-to-JSON handling.
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  });
}

export interface Caller {
  id: string;
  client: SupabaseClient; // acts as the caller, so RLS applies
  profile: { id: string; username: string; is_super_admin: boolean; status: string; features: Record<string, boolean> | null };
}

// Resolves the signed-in caller from the Authorization header and rejects
// suspended accounts, so they cannot spend API credits.
export async function requireCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new HttpError(401, "Please sign in.");

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user }, error } = await client.auth.getUser(authHeader.slice(7));
  if (error || !user) throw new HttpError(401, "Please sign in.");

  const { data: profile } = await client
    .from("profiles")
    .select("id, username, is_super_admin, status, features")
    .eq("id", user.id)
    .single();
  if (!profile || profile.status !== "active") throw new HttpError(403, "Your access has been suspended.");

  return { id: user.id, client, profile };
}

// Features that stay off until a super admin turns them on (src/features.js).
const OFF_BY_DEFAULT = new Set(["meeting", "todo", "notes"]);

// Refuses a feature that is off for this user. Super admins have everything.
export function requireFeature(caller: Caller, feature: string, label: string) {
  const set = caller.profile.features?.[feature];
  const on = caller.profile.is_super_admin || (typeof set === "boolean" ? set : !OFF_BY_DEFAULT.has(feature));
  if (!on) {
    throw new HttpError(403, `${label} is turned off for your account. Ask your super admin.`);
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}
