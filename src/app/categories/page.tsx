import { PageHeader } from "../(protected)/page-header";
import { getAuthorizedPageContext, toNumber } from "../(protected)/data";

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
  created_at: string;
};

type TransactionRow = {
  category_id: string | null;
  amount: number | string;
};

export default async function CategoriesPage() {
  const { adminSupabase, email, householdId } = await getAuthorizedPageContext();
  let categories: CategoryRow[] = [];
  let transactionTotals = new Map<string, { spent: number; count: number }>();
  let loadError = false;

  if (householdId) {
    try {
      const [{ data: categoryData, error: categoriesError }, { data: transactionData, error: transactionsError }] =
        await Promise.all([
          adminSupabase
            .from("categories")
            .select("id, name, kind, created_at")
            .eq("household_id", householdId)
            .order("name", { ascending: true }),
          adminSupabase
            .from("transactions")
            .select("category_id, amount")
            .eq("household_id", householdId),
        ]);

      if (categoriesError) {
        throw categoriesError;
      }

      if (transactionsError) {
        throw transactionsError;
      }

      categories = (categoryData ?? []) as CategoryRow[];

      for (const transaction of (transactionData ?? []) as TransactionRow[]) {
        if (!transaction.category_id) {
          continue;
        }

        const current = transactionTotals.get(transaction.category_id) ?? {
          spent: 0,
          count: 0,
        };

        current.spent += Math.abs(toNumber(transaction.amount));
        current.count += 1;
        transactionTotals.set(transaction.category_id, current);
      }
    } catch (error) {
      loadError = true;
      console.error("Failed to load categories:", error);
    }
  }

  const maxSpent = Math.max(
    0,
    ...categories.map((category) => transactionTotals.get(category.id)?.spent ?? 0),
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <PageHeader
        title="Categories"
        description="Live spending categories and how often they are used."
        email={email}
      />

      {loadError ? (
        <p className="mb-6 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          We couldn&apos;t load categories right now.
        </p>
      ) : null}

      {!householdId ? (
        <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Create a household to start organizing categories.
        </p>
      ) : null}

      {householdId && !loadError && categories.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No categories have been created yet.
        </p>
      ) : null}

      <ul className="space-y-3">
        {categories.map((category) => {
          const stats = transactionTotals.get(category.id) ?? { spent: 0, count: 0 };
          const width =
            maxSpent > 0 ? `${Math.max((stats.spent / maxSpent) * 100, 6)}%` : "0%";

          return (
            <li
              key={category.id}
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{category.name}</p>
                  <p className="mt-1 text-sm capitalize text-zinc-600 dark:text-zinc-400">
                    {category.kind}
                  </p>
                </div>
                <div className="text-right text-sm text-zinc-600 dark:text-zinc-400">
                  <p>{stats.count} transaction{stats.count === 1 ? "" : "s"}</p>
                  <p className="mt-1">${stats.spent.toFixed(2)} total</p>
                </div>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
