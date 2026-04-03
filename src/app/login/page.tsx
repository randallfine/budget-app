import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendMagicLink } from "./actions";
import { LoginScreen } from "./login-screen";

const getErrorMessage = (error?: string, detail?: string, wait?: string) => {
  switch (error) {
    case "config":
      return "Supabase is not configured yet. Add your project URL and anon key.";
    case "expired":
      return "That magic link is invalid or expired. Please request a new one.";
    case "missing_code":
      return "The magic link was incomplete. Please request a new one.";
    case "invalid_email":
      return "Enter a valid email address to receive a magic link.";
    case "unauthorized_email":
      return "This email address is not authorized.";
    case "allowlist_failed":
      return "We couldn't verify access right now. Please try again.";
    case "rate_limited": {
      const waitSeconds = wait ? Number.parseInt(wait, 10) : Number.NaN;
      return Number.isFinite(waitSeconds) && waitSeconds > 0
        ? `A magic link was already requested recently. Please wait ${waitSeconds} seconds, then try again.`
        : "A magic link was already requested recently. Please wait about a minute, then try again.";
    }
    case "send_failed":
      return detail
        ? `We couldn't send the magic link: ${detail}`
        : "We couldn't send the magic link. Check your Supabase email auth settings and try again.";
    default:
      return undefined;
  }
};

type LoginPageProps = {
  searchParams?: Promise<{
    sent?: string;
    error?: string;
    detail?: string;
    wait?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const sent = resolvedSearchParams?.sent === "1";
  const error = getErrorMessage(
    resolvedSearchParams?.error,
    resolvedSearchParams?.detail,
    resolvedSearchParams?.wait,
  );

  return (
    <LoginScreen
      action={sendMagicLink}
      message={sent ? "Check your email for a magic link to finish signing in." : undefined}
      error={error}
    />
  );
}
