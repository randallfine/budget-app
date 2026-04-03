"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { isAllowedUserEmail } from "@/lib/supabase/allowed-users";
import {
  buildReadableImportedAccountName,
  buildTransactionNotes,
  findMatchingAccount,
  findMatchingCategory,
  matchesImportedTransaction,
  normalizeImportedTransaction,
  requiresTransactionNameReview,
} from "@/lib/imports/normalization";
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

  return { adminSupabase, householdId: household.id, user };
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

type ImportedTransactionForApproval = {
  id: string;
  household_id: string;
  source: string;
  external_id: string;
  transaction_date: string;
  account_type: string | null;
  account_name: string | null;
  account_number: string | null;
  institution_name: string | null;
  merchant_name: string;
  custom_name: string | null;
  amount: number | string;
  description: string | null;
  category: string | null;
  note: string | null;
};

type AccountRow = {
  id: string;
  name: string;
  institution: string | null;
  type: string;
};

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
};

type ExistingTransactionRow = {
  id: string;
  description: string | null;
  notes: string | null;
};

async function deleteImportedTransaction(adminSupabase: ReturnType<typeof createAdminClient>, id: string) {
  const { error } = await adminSupabase.from("imported_transactions").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function approveImportedTransaction(formData: FormData) {
  const importedTransactionId = formData.get("importedTransactionId");

  if (typeof importedTransactionId !== "string" || !importedTransactionId.trim()) {
    redirect("/imports?error=approval_failed&detail=Missing%20staged%20transaction%20id.");
  }

  try {
    const { adminSupabase, householdId, user } = await getAuthorizedHouseholdId();
    const { data: importedTransactionData, error: importedTransactionError } = await adminSupabase
      .from("imported_transactions")
      .select(
        "id, household_id, source, external_id, transaction_date, account_type, account_name, account_number, institution_name, merchant_name, custom_name, amount, description, category, note",
      )
      .eq("household_id", householdId)
      .eq("id", importedTransactionId)
      .maybeSingle();

    if (importedTransactionError) {
      throw importedTransactionError;
    }

    const importedTransaction = importedTransactionData as ImportedTransactionForApproval | null;

    if (!importedTransaction) {
      redirect("/imports?error=approval_failed&detail=That%20staged%20transaction%20was%20not%20found.");
    }

    if (requiresTransactionNameReview(importedTransaction)) {
      redirect(
        "/imports?error=approval_failed&detail=Please%20validate%20the%20transaction%20name%20mapping%20before%20approval.",
      );
    }

    const normalized = normalizeImportedTransaction(importedTransaction);
    const [
      { data: accountData, error: accountsError },
      { data: categoryData, error: categoriesError },
      { data: similarImportedData, error: similarImportedError },
    ] =
      await Promise.all([
        adminSupabase
          .from("accounts")
          .select("id, name, institution, type")
          .eq("household_id", householdId),
        adminSupabase
          .from("categories")
          .select("id, name, kind")
          .eq("household_id", householdId),
        adminSupabase
          .from("imported_transactions")
          .select(
            "source, external_id, amount, merchant_name, custom_name, description, category, note, institution_name, account_name, account_number, account_type",
          )
          .eq("household_id", householdId)
          .eq("institution_name", importedTransaction.institution_name)
          .eq("account_name", importedTransaction.account_name)
          .eq("account_type", importedTransaction.account_type),
      ]);

    if (accountsError) {
      throw accountsError;
    }

    if (categoriesError) {
      throw categoriesError;
    }

    if (similarImportedError) {
      throw similarImportedError;
    }

    const accounts = ((accountData ?? []) as AccountRow[]).slice();
    const categories = ((categoryData ?? []) as CategoryRow[]).slice();
    const similarImportedTransactions =
      ((similarImportedData ?? []) as ImportedTransactionForApproval[]) ?? [];
    const readableAccountName = buildReadableImportedAccountName(
      normalized,
      similarImportedTransactions,
      accounts,
    );

    let account = findMatchingAccount(accounts, normalized);

    if (!account) {
      const { data: createdAccount, error: createAccountError } = await adminSupabase
        .from("accounts")
        .insert({
          household_id: householdId,
          name: readableAccountName,
          institution: normalized.institutionName,
          type: normalized.accountType,
          starting_balance: 0,
        })
        .select("id, name, institution, type")
        .single();

      if (createAccountError) {
        throw createAccountError;
      }

      account = createdAccount as AccountRow;
      accounts.push(account);
    }

    let category = findMatchingCategory(categories, normalized);

    if (!category && normalized.categoryName) {
      const { data: createdCategory, error: createCategoryError } = await adminSupabase
        .from("categories")
        .insert({
          household_id: householdId,
          name: normalized.categoryName,
          kind: normalized.categoryKind,
        })
        .select("id, name, kind")
        .single();

      if (createCategoryError) {
        throw createCategoryError;
      }

      category = createdCategory as CategoryRow;
      categories.push(category);
    }

    const { data: existingTransactionData, error: existingTransactionsError } = await adminSupabase
      .from("transactions")
      .select("id, description, notes")
      .eq("household_id", householdId)
      .eq("account_id", account.id)
      .eq("transaction_date", importedTransaction.transaction_date)
      .eq("amount", importedTransaction.amount);

    if (existingTransactionsError) {
      throw existingTransactionsError;
    }

    const existingTransactions = (existingTransactionData ?? []) as ExistingTransactionRow[];
    const isDuplicate = existingTransactions.some((transaction) =>
      matchesImportedTransaction(
        transaction,
        normalized,
        importedTransaction.source,
        importedTransaction.external_id,
      ),
    );

    if (isDuplicate) {
      await deleteImportedTransaction(adminSupabase, importedTransaction.id);
      revalidatePath("/imports");
      revalidatePath("/transactions");
      redirect("/imports?duplicate=1");
    }

    const { error: insertTransactionError } = await adminSupabase.from("transactions").insert({
      household_id: householdId,
      account_id: account.id,
      category_id: category?.id ?? null,
      amount: importedTransaction.amount,
      transaction_date: importedTransaction.transaction_date,
      description: normalized.transactionName,
      notes: buildTransactionNotes(importedTransaction, normalized),
      created_by: user.id,
    });

    if (insertTransactionError) {
      throw insertTransactionError;
    }

    await deleteImportedTransaction(adminSupabase, importedTransaction.id);

    revalidatePath("/imports");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/categories");
    revalidatePath("/dashboard");

    redirect("/imports?approved=1");
  } catch (error) {
    unstable_rethrow(error);
    console.error("Staged transaction approval failed:", error);
    const detail =
      error instanceof Error ? sanitizeErrorMessage(error.message) : "Unexpected approval error.";

    redirect(`/imports?error=approval_failed&detail=${encodeURIComponent(detail)}`);
  }
}

export async function saveImportedTransactionNameReview(formData: FormData) {
  const importedTransactionId = formData.get("importedTransactionId");
  const reviewedName = formData.get("reviewedName");

  if (typeof importedTransactionId !== "string" || !importedTransactionId.trim()) {
    redirect("/imports?error=approval_failed&detail=Missing%20staged%20transaction%20id.");
  }

  if (typeof reviewedName !== "string" || !reviewedName.trim()) {
    redirect(
      "/imports?error=approval_failed&detail=Enter%20the%20transaction%20name%20you%20want%20to%20use.",
    );
  }

  try {
    const { adminSupabase, householdId } = await getAuthorizedHouseholdId();
    const { error } = await adminSupabase
      .from("imported_transactions")
      .update({
        custom_name: reviewedName.trim(),
      })
      .eq("household_id", householdId)
      .eq("id", importedTransactionId);

    if (error) {
      throw error;
    }

    revalidatePath("/imports");
    redirect("/imports?name_reviewed=1");
  } catch (error) {
    unstable_rethrow(error);
    console.error("Imported transaction name review failed:", error);
    const detail =
      error instanceof Error ? sanitizeErrorMessage(error.message) : "Unexpected review error.";

    redirect(`/imports?error=approval_failed&detail=${encodeURIComponent(detail)}`);
  }
}
