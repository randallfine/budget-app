"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { isAllowedUserEmail } from "@/lib/supabase/allowed-users";
import { parseRocketMoneyCsv } from "@/lib/imports/rocket-money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_ERROR_LENGTH = 160;

function sanitizeErrorMessage(message: string) {
  return message.trim().replace(/\s+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

function isMissingImportedTransactionsTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  const message = "message" in error ? error.message : undefined;

  return (
    code === "PGRST205" &&
    typeof message === "string" &&
    message.includes("public.imported_transactions")
  );
}

function dedupeImportedTransactions<
  T extends { household_id: string; source: string; external_id: string },
>(rows: T[]) {
  const uniqueRows = new Map<string, T>();

  for (const row of rows) {
    const key = `${row.household_id}:${row.source}:${row.external_id}`;
    uniqueRows.set(key, row);
  }

  return Array.from(uniqueRows.values());
}

async function getAuthorizedHouseholdId() {
  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  const isAllowed = await isAllowedUserEmail(supabase, user.email);

  if (!isAllowed) {
    await supabase.auth.signOut();
    redirect("/not-authorized");
  }

  const { data: household, error } = await adminSupabase
    .from("households")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!household) {
    throw new Error("No household was found. Create a household before importing transactions.");
  }

  return { adminSupabase, householdId: household.id };
}

async function getAuthorizedContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  const isAllowed = await isAllowedUserEmail(supabase, user.email);

  if (!isAllowed) {
    await supabase.auth.signOut();
    redirect("/not-authorized");
  }

  return { supabase, user };
}

export async function createDefaultHousehold() {
  try {
    const { user } = await getAuthorizedContext();
    const adminSupabase = createAdminClient();
    const { data: existingHousehold, error: existingHouseholdError } = await adminSupabase
      .from("households")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingHouseholdError) {
      throw existingHouseholdError;
    }

    if (existingHousehold) {
      redirect("/imports?household=exists");
    }

    const insertCandidates = [
      { name: "Primary Household" },
      { name: "Primary Household", owner_id: user.id },
      { name: "Primary Household", created_by: user.id },
      { name: "Primary Household", user_id: user.id },
      {},
    ];

    let lastError: unknown = null;

    for (const candidate of insertCandidates) {
      const { data, error } = await adminSupabase
        .from("households")
        .insert(candidate)
        .select("id")
        .single();

      if (!error && data) {
        redirect("/imports?household=created");
      }

      lastError = error;
    }

    throw lastError ?? new Error("Unable to create a household.");
  } catch (error) {
    unstable_rethrow(error);
    console.error("Default household creation failed:", error);
    const detail =
      error instanceof Error ? sanitizeErrorMessage(error.message) : "Unexpected household error.";

    redirect(
      `/imports?error=household_create_failed&detail=${encodeURIComponent(detail)}`,
    );
  }
}

export async function importRocketMoneyCsv(formData: FormData) {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/imports?error=missing_file");
  }

  try {
    const { adminSupabase, householdId } = await getAuthorizedHouseholdId();
    const csvText = await file.text();
    const transactions = parseRocketMoneyCsv(csvText);
    let importedCount = 0;

    if (transactions.length === 0) {
      throw new Error("The selected CSV did not contain any transactions.");
    }

    const payload = transactions.map((transaction) => ({
      household_id: householdId,
      source: transaction.source,
      external_id: transaction.externalId,
      transaction_date: transaction.date,
      original_date: transaction.originalDate,
      account_type: transaction.accountType,
      account_name: transaction.accountName,
      account_number: transaction.accountNumber,
      institution_name: transaction.institutionName,
      merchant_name: transaction.merchantName,
      custom_name: transaction.customName,
      amount: transaction.amount,
      description: transaction.description,
      category: transaction.category,
      note: transaction.note,
      ignored_from: transaction.ignoredFrom,
      tax_deductible: transaction.taxDeductible,
      transaction_tags: transaction.transactionTags,
      raw_data: transaction.rawData,
    }));

    const dedupedPayload = dedupeImportedTransactions(payload);

    const { error } = await adminSupabase
      .from("imported_transactions")
      .upsert(dedupedPayload, {
        onConflict: "household_id,source,external_id",
        ignoreDuplicates: false,
      });

    if (error) {
      throw error;
    }
    importedCount = dedupedPayload.length;

    redirect(`/imports?imported=${importedCount}`);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Rocket Money import failed:", error);

    if (isMissingImportedTransactionsTableError(error)) {
      redirect("/imports?error=missing_import_table");
    }

    if (
      error instanceof Error &&
      error.message ===
        "No household was found. Create a household before importing transactions."
    ) {
      redirect("/imports?error=missing_household");
    }

    const detail =
      error instanceof Error ? sanitizeErrorMessage(error.message) : "Unexpected import error.";

    redirect(`/imports?error=import_failed&detail=${encodeURIComponent(detail)}`);
  }
}
