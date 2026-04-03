"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedUserEmail } from "@/lib/supabase/allowed-users";

const MAX_ERROR_LENGTH = 160;

function sanitizeErrorMessage(message: string) {
  return message.trim().replace(/\s+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

function getRateLimitWaitSeconds(message: string) {
  const match = message.match(/after\s+(\d+)\s+seconds?/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export async function sendMagicLink(formData: FormData) {
  const email = formData.get("email");

  if (typeof email !== "string" || !email.trim()) {
    redirect("/login?error=invalid_email");
  }

  const supabase = await createClient();
  const normalizedEmail = email.trim().toLowerCase();

  let isAllowed = false;

  try {
    isAllowed = await isAllowedUserEmail(supabase, normalizedEmail);
  } catch {
    redirect("/login?error=allowlist_failed");
  }

  if (!isAllowed) {
    redirect("/login?error=unauthorized_email");
  }

  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    console.error("Magic link send failed:", error);

    if (error.code === "over_email_send_rate_limit") {
      const waitSeconds = getRateLimitWaitSeconds(error.message);
      const waitParam =
        typeof waitSeconds === "number" && Number.isFinite(waitSeconds)
          ? `&wait=${waitSeconds}`
          : "";

      redirect(`/login?error=rate_limited${waitParam}`);
    }

    const errorDetail = sanitizeErrorMessage(error.message);
    redirect(
      `/login?error=send_failed&detail=${encodeURIComponent(errorDetail)}`,
    );
  }

  redirect("/login?sent=1");
}
