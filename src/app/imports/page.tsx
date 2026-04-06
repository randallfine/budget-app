import { redirect } from "next/navigation";
import { findRecurringCandidates } from "@/lib/imports/recurrence";
import { isAllowedUserEmail } from "@/lib/supabase/allowed-users";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "../(protected)/page-header";
import { createDefaultHousehold, importRocketMoneyCsv } from "./actions";
import { ImportSubmitButton } from "./import-submit-button";
import { StagedTransactionsTable } from "./staged-transactions-table";

type ImportedTransactionRow = {
  id: string;
  external_id: string;
  transaction_date: string;
  account_type: string | null;
  account_number: string | null;
  merchant_name: string;
  custom_name: string | null;
  reviewed_transaction_type: string | null;
  amount: number | string;
  description: string | null;
  category: string | null;
  note: string | null;
  account_name: string | null;
  institution_name: string | null;
  source: string;
  created_at: string;
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

type TransactionNameRow = {
  description: string | null;
};

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

const getErrorMessage = (error?: string, detail?: string) => {
  switch (error) {
    case "missing_file":
      return "Choose a Rocket Money CSV file before importing.";
    case "empty_file":
      return "The selected CSV did not contain any transactions.";
    case "import_failed":
      return detail
        ? `Import failed: ${detail}`
        : "The import could not be completed.";
    case "missing_household":
      return "Create or seed a household first, then you can import transactions.";
    case "household_create_failed":
      return detail
        ? `We couldn't create the default household: ${detail}`
        : "We couldn't create the default household.";
    case "missing_import_table":
      return "The imported_transactions table is missing in Supabase. Apply the pending database migration, then try the import again.";
    case "approval_failed":
      return detail
        ? `Approval failed: ${detail}`
        : "The staged transaction could not be approved.";
    default:
      return undefined;
  }
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

type ImportsPageProps = {
  searchParams?: Promise<{
    imported?: string;
    approved?: string;
    duplicate?: string;
    batch_approved?: string;
    batch_duplicates?: string;
    batch_review?: string;
    name_reviewed?: string;
    type_reviewed?: string;
    error?: string;
    detail?: string;
    household?: string;
  }>;
};

export default async function ImportsPage({ searchParams }: ImportsPageProps) {
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

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const importedCount = Number.parseInt(resolvedSearchParams?.imported ?? "", 10);
  const batchApprovedCount = Number.parseInt(resolvedSearchParams?.batch_approved ?? "", 10);
  const batchDuplicateCount = Number.parseInt(resolvedSearchParams?.batch_duplicates ?? "", 10);
  const batchReviewCount = Number.parseInt(resolvedSearchParams?.batch_review ?? "", 10);
  const successMessage =
    Number.isFinite(importedCount) && importedCount > 0
      ? `Imported ${importedCount} Rocket Money transaction${importedCount === 1 ? "" : "s"}.`
      : Number.isFinite(batchApprovedCount) ||
          Number.isFinite(batchDuplicateCount) ||
          Number.isFinite(batchReviewCount)
        ? `Batch approval finished: ${Number.isFinite(batchApprovedCount) ? batchApprovedCount : 0} approved, ${Number.isFinite(batchDuplicateCount) ? batchDuplicateCount : 0} duplicates removed, ${Number.isFinite(batchReviewCount) ? batchReviewCount : 0} still need review.`
      : resolvedSearchParams?.approved === "1"
        ? "Approved the staged transaction and moved it into Transactions."
        : resolvedSearchParams?.duplicate === "1"
          ? "That staged transaction already existed in Transactions, so it was skipped and removed from staging."
          : resolvedSearchParams?.name_reviewed === "1"
            ? "Saved the reviewed transaction name."
            : resolvedSearchParams?.type_reviewed === "1"
              ? "Saved the reviewed transaction type."
      : undefined;
  const householdMessage =
    resolvedSearchParams?.household === "created"
      ? "Default household created. You can import transactions now."
      : resolvedSearchParams?.household === "exists"
        ? "A household already exists, so no new one was created."
        : undefined;
  const errorMessage = getErrorMessage(
    resolvedSearchParams?.error,
    resolvedSearchParams?.detail,
  );
  const adminSupabase = createAdminClient();
  let importedTransactions: ImportedTransactionRow[] = [];
  let accounts: AccountRow[] = [];
  let categories: CategoryRow[] = [];
  let existingTransactionNames: string[] = [];
  let recurringCandidates: ReturnType<typeof findRecurringCandidates> = [];
  let loadError = false;
  let loadErrorMessage: string | undefined;
  let hasHousehold = false;
  let importsTableMissing = false;
  const batchFormId = "batch-import-approval-form";

  try {
    const { data: household, error: householdError } = await adminSupabase
      .from("households")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (householdError) {
      throw householdError;
    }

    if (household) {
      hasHousehold = true;
      const [
        { data: importedData, error: importedError },
        { data: accountData, error: accountError },
        { data: categoryData, error: categoryError },
        { data: transactionNameData, error: transactionNameError },
      ] = await Promise.all([
        adminSupabase
          .from("imported_transactions")
          .select(
            "id, external_id, transaction_date, account_type, account_number, merchant_name, custom_name, reviewed_transaction_type, amount, description, category, note, account_name, institution_name, source, created_at",
          )
          .eq("household_id", household.id)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(250),
        adminSupabase
          .from("accounts")
          .select("id, name, institution, type")
          .eq("household_id", household.id),
        adminSupabase
          .from("categories")
          .select("id, name, kind")
          .eq("household_id", household.id),
        adminSupabase
          .from("transactions")
          .select("description")
          .eq("household_id", household.id)
          .not("description", "is", null)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

      if (importedError) {
        throw importedError;
      }

      if (accountError) {
        throw accountError;
      }

      if (categoryError) {
        throw categoryError;
      }

      if (transactionNameError) {
        throw transactionNameError;
      }

      importedTransactions = (importedData ?? []) as ImportedTransactionRow[];
      accounts = (accountData ?? []) as AccountRow[];
      categories = (categoryData ?? []) as CategoryRow[];
      existingTransactionNames = Array.from(
        new Set(
          ((transactionNameData ?? []) as TransactionNameRow[])
            .map((transaction) => transaction.description?.trim() ?? "")
            .filter(Boolean),
        ),
      );
      recurringCandidates = findRecurringCandidates(importedTransactions, accounts);
      importedTransactions = importedTransactions.slice(0, 25);
    }
  } catch (error) {
    loadError = true;
    if (isMissingImportedTransactionsTableError(error)) {
      importsTableMissing = true;
      loadErrorMessage =
        "The imported_transactions table is missing in Supabase. Apply the pending database migration to enable imports and staged transaction history.";
    }
    console.error("Failed to load imported transactions:", error);
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <PageHeader
        title="Imports"
        description="Upload a Rocket Money CSV and stage the rows in Supabase for review."
        email={user.email}
      />

      <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Rocket Money CSV</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Supported columns: Date, Original Date, Account Type, Account Name,
          Account Number, Institution Name, Name, Custom Name, Amount,
          Description, Category, Note, Ignored From, Tax Deductible, and
          Transaction Tags.
        </p>

        {successMessage ? (
          <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMessage}
          </p>
        ) : null}

        {householdMessage ? (
          <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {householdMessage}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {errorMessage}
          </p>
        ) : null}

        {!hasHousehold ? (
          <div className="mt-4 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <p>
              No household exists yet. Create the default household before
              importing Rocket Money data.
            </p>
            <form action={createDefaultHousehold} className="mt-3">
              <button
                type="submit"
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
              >
                Create Default Household
              </button>
            </form>
          </div>
        ) : null}

        <form action={importRocketMoneyCsv} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="file">
              CSV file
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <ImportSubmitButton disabled={!hasHousehold || importsTableMissing} />
        </form>

        {importsTableMissing ? (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Imports are temporarily disabled until the `imported_transactions`
            migration has been applied to Supabase.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">What Gets Stored</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>The upload is normalized into a consistent transaction shape.</li>
          <li>Each row is upserted by `household_id`, `source`, and `external_id`.</li>
          <li>The original Rocket Money row is preserved in `raw_data` for traceability.</li>
        </ul>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        {loadError ? (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {loadErrorMessage ?? "We couldn&apos;t load the staged import rows right now."}
          </p>
        ) : null}

        {!loadError ? (
          <StagedTransactionsTable
            initialTransactions={importedTransactions}
            accounts={accounts}
            categories={categories}
            existingTransactionNames={existingTransactionNames}
            batchFormId={batchFormId}
          />
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recurring Candidates</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Repeating staged transactions inferred from up to 250 imported rows.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Detected patterns</p>
            <p className="font-mono text-sm">{recurringCandidates.length}</p>
          </div>
        </div>

        {loadError ? null : recurringCandidates.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            No recurring patterns were detected yet. This usually means there are not enough repeated staged transactions, or the timing and amounts vary too much to infer a schedule confidently.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-3 font-medium">Transaction</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Repeats</th>
                  <th className="px-4 py-3 font-medium">Next Due</th>
                  <th className="px-4 py-3 font-medium">Payoff / End</th>
                </tr>
              </thead>
              <tbody>
                {recurringCandidates.map((candidate) => (
                  <tr
                    key={candidate.key}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{candidate.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Seen {candidate.occurrences} times from {candidate.firstSeenDate} to{" "}
                        {candidate.lastSeenDate}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {candidate.accountLabel}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatCurrency(candidate.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-600 dark:text-zinc-400">
                        {candidate.cadenceLabel}
                      </p>
                      <p className="text-xs text-zinc-500 capitalize dark:text-zinc-400">
                        {candidate.confidence} confidence
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {candidate.nextExpectedDate ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3">
                      {candidate.remainingPayments !== null ? (
                        <>
                          <p className="text-zinc-600 dark:text-zinc-400">
                            {candidate.remainingPayments} payment
                            {candidate.remainingPayments === 1 ? "" : "s"} left
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {candidate.paymentsCompleted}/{candidate.totalPayments} completed
                            {candidate.endDate ? ` • Est. end ${candidate.endDate}` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="text-zinc-500 dark:text-zinc-400">
                          No payoff estimate in imported data
                        </p>
                      )}
                      {candidate.needsValidation ? (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {candidate.validationReason}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
