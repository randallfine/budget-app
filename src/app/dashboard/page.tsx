import { PageHeader } from "../(protected)/page-header";
import {
  formatCurrency,
  getAuthorizedPageContext,
  toNumber,
} from "../(protected)/data";

type AccountRow = {
  id: string;
  name: string;
  institution: string | null;
  starting_balance: number | string;
};

type TransactionRow = {
  id: string;
  description: string | null;
  amount: number | string;
  transaction_date: string;
};

type RecurringItemRow = {
  item_type: string;
  amount: number | string;
  frequency: string;
};

function toMonthlyAmount(item: RecurringItemRow) {
  const amount = toNumber(item.amount);
  return item.frequency === "Bi-Weekly" ? (amount * 26) / 12 : amount;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default async function DashboardPage() {
  const { adminSupabase, email, householdId } = await getAuthorizedPageContext();
  let loadError = false;
  let totalBalance = 0;
  let monthlyIncome = 0;
  let monthlySpend = 0;
  let recentTransactions: TransactionRow[] = [];

  if (householdId) {
    try {
      const [{ data: accounts, error: accountsError }, { data: recurringItems, error: recurringError }, { data: transactions, error: transactionsError }] =
        await Promise.all([
          adminSupabase
            .from("accounts")
            .select("id, name, institution, starting_balance")
            .eq("household_id", householdId),
          adminSupabase
            .from("recurring_items")
            .select("item_type, amount, frequency")
            .eq("household_id", householdId),
          adminSupabase
            .from("transactions")
            .select("id, description, amount, transaction_date")
            .eq("household_id", householdId)
            .order("transaction_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(8),
        ]);

      if (accountsError) {
        throw accountsError;
      }

      if (recurringError) {
        throw recurringError;
      }

      if (transactionsError) {
        throw transactionsError;
      }

      totalBalance = ((accounts ?? []) as AccountRow[]).reduce(
        (sum, account) => sum + toNumber(account.starting_balance),
        0,
      );

      for (const item of (recurringItems ?? []) as RecurringItemRow[]) {
        const monthlyAmount = toMonthlyAmount(item);
        if (item.item_type === "income") {
          monthlyIncome += monthlyAmount;
        } else if (item.item_type === "expense") {
          monthlySpend += monthlyAmount;
        }
      }

      recentTransactions = (transactions ?? []) as TransactionRow[];
    } catch (error) {
      loadError = true;
      console.error("Failed to load dashboard data:", error);
    }
  }

  const stats = [
    { label: "Total Balance", value: formatCurrency(totalBalance) },
    { label: "Monthly Income", value: formatCurrency(monthlyIncome) },
    { label: "Monthly Spend", value: formatCurrency(monthlySpend) },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <PageHeader
        title="Dashboard"
        description="Budget overview and activity."
        email={email}
      />

      {loadError ? (
        <p className="mb-6 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          We couldn&apos;t load your dashboard data right now.
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((item) => (
          <article
            key={item.label}
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Recent Transactions</h2>

        {!householdId ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            Create a household to start seeing live dashboard data.
          </p>
        ) : null}

        {householdId && !loadError && recentTransactions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            No transactions have been recorded yet.
          </p>
        ) : null}

        {householdId && !loadError && recentTransactions.length > 0 ? (
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
            {recentTransactions.map((tx) => {
              const amount = toNumber(tx.amount);
              return (
                <li key={tx.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{tx.description?.trim() || "Untitled transaction"}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatShortDate(tx.transaction_date)}
                    </p>
                  </div>
                  <p
                    className={`font-mono text-sm ${
                      amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : ""
                    }`}
                  >
                    {formatCurrency(amount)}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
