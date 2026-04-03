import type { SupabaseClient } from "@supabase/supabase-js";

export async function isAllowedUserEmail(
  supabase: SupabaseClient,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("allowed_users")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
