import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

export const SUPABASE_URL = "https://vciasenjredzlilzqaln.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FB2SGE46ft32EQ7KN6qrOg_QGDmPxWX";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
