import { PageHeader } from "../(protected)/page-header";
import {
  formatCurrency,
  getAuthorizedPageContext,
  toNumber,
} from "../(protected)/data";

type TransactionRow = {
  id: string;
  account_id: string;
  category_id: string | null;
  amount: number | string;
  transaction_date: string;
  description: string | null;
  notes: string | null;
  created_at: string;
};

type AccountRow = {
  id: string;
  name: string;
};

type CategoryRow = {
  id: string;
  name: string;
};

export default async function TransactionsPage() {
  const { adminSupabase, email, householdId } = await getAuthorizedPageContext();
  let transactions: TransactionRow[] = [];
  let accountNames = new Map<string, string>();
  let categoryNames = new Map<string, string>();
  let loadError = false;

  if (householdId) {
    try {
      const [{ data: transactionData, error: transactionsError }, { data: accountData, error: accountsError }, { data: categoryData, error: categoriesError }] =
        await Promise.all([
          adminSupabase
            .from("transactions")
            .select(
              "id, account_id, category_id, amount, transaction_date, description, notes, created_at",
            )
            .eq("household_id", householdId)
            .order("transaction_date", { ascending: false })
            .order("created_at", { ascending: false }),
          adminSupabase
            .from("accounts")
            .select("id, name")
            .eq("household_id", householdId),
          adminSupabase
            .from("categories")
            .select("id, name")
            .eq("household_id", householdId),
        ]);

      if (transactionsError) {
        throw transactionsError;
      }

      if (accountsError) {
        throw accountsError;
      }

      if (categoriesError) {
        throw categoriesError;
      }

      transactions = (transactionData ?? []) as TransactionRow[];
      accountNames = new Map(
        ((accountData ?? []) as AccountRow[]).map((account) => [account.id, account.name]),
      );
      categoryNames = new Map(
        ((categoryData ?? []) as CategoryRow[]).map((category) => [
          category.id,
          category.name,
        ]),
      );
    } catch (error) {
      loadError = true;
      console.error("Failed to load transactions:", error);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <PageHeader
        title="Transactions"
        description="Live posted transactions for the active household."
        email={email}
      />

      {loadError ? (
        <p className="mb-6 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          We couldn&apos;t load transactions right now.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {!householdId ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-zinc-600 dark:text-zinc-400">
                  Create a household to start tracking transactions.
                </td>
              </tr>
            ) : null}

            {householdId && !loadError && transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-zinc-600 dark:text-zinc-400">
                  No transactions have been recorded yet.
                </td>
              </tr>
            ) : null}

            {transactions.map((tx) => {
              const amount = toNumber(tx.amount);
              return (
                <tr key={tx.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {tx.transaction_date}
                  </td>
                  <td className="px-4 py-3">{tx.description?.trim() || "Untitled transaction"}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {accountNames.get(tx.account_id) ?? "Unknown account"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {tx.category_id ? categoryNames.get(tx.category_id) ?? "Unknown category" : "Uncategorized"}
                  </td>
                  <td
                    className={`px-4 py-3 font-mono ${
                      amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : ""
                    }`}
                  >
                    {formatCurrency(amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
