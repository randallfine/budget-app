import { redirect } from "next/navigation";
import { isAllowedUserEmail } from "@/lib/supabase/allowed-users";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "../(protected)/page-header";

type RecurringItem = {
  id: number;
  name: string;
  itemType: "income" | "expense";
  groupName: string;
  amount: number;
  frequency: string;
  dueDay: number | null;
  notes: string | null;
};

type RecurringItemRow = {
  id: number;
  name: string;
  item_type: string;
  group_name: string;
  amount: number | string;
  frequency: string;
  due_day: number | null;
  notes: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function toMonthlyAmount(item: RecurringItem) {
  if (item.frequency === "Bi-Weekly") {
    return (item.amount * 26) / 12;
  }

  return item.amount;
}

function formatDueDay(dueDay: number | null) {
  return dueDay ? `Day ${dueDay}` : "Varies";
}

function groupItems(items: RecurringItem[]) {
  return Object.entries(
    items.reduce<Record<string, RecurringItem[]>>((groups, item) => {
      groups[item.groupName] ??= [];
      groups[item.groupName].push(item);
      return groups;
    }, {}),
  ).sort(([groupA], [groupB]) => groupA.localeCompare(groupB));
}

function mapRecurringItem(row: RecurringItemRow): RecurringItem | null {
  if (row.item_type !== "income" && row.item_type !== "expense") {
    return null;
  }

  const amount =
    typeof row.amount === "number" ? row.amount : Number.parseFloat(row.amount);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    itemType: row.item_type,
    groupName: row.group_name,
    amount,
    frequency: row.frequency,
    dueDay: row.due_day,
    notes: row.notes,
  };
}

async function loadRecurringItems() {
  const adminSupabase = createAdminClient();
  const { data: household, error: householdError } = await adminSupabase
    .from("households")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (householdError) {
    throw householdError;
  }

  if (!household) {
    return [];
  }

  const { data, error } = await adminSupabase
    .from("recurring_items")
    .select("id, name, item_type, group_name, amount, frequency, due_day, notes")
    .eq("household_id", household.id)
    .order("item_type", { ascending: true })
    .order("group_name", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RecurringItemRow[])
    .map(mapRecurringItem)
    .filter((item): item is RecurringItem => item !== null);
}

export default async function RecurringPage() {
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

  let recurringItems: RecurringItem[] = [];
  let loadError = false;

  try {
    recurringItems = await loadRecurringItems();
  } catch (error) {
    loadError = true;
    console.error("Failed to load recurring items:", error);
  }

  const incomeItems = recurringItems.filter((item) => item.itemType === "income");
  const expenseItems = recurringItems.filter((item) => item.itemType === "expense");
  const monthlyIncome = incomeItems.reduce((sum, item) => sum + toMonthlyAmount(item), 0);
  const monthlyExpenses = expenseItems.reduce((sum, item) => sum + toMonthlyAmount(item), 0);
  const monthlyNet = monthlyIncome - monthlyExpenses;
  const groupedExpenses = groupItems(expenseItems);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <PageHeader
        title="Recurring Income & Expenses"
        description="A planning view of repeating income and bills from your live recurring item data."
        email={user.email}
      />

      {loadError ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          We couldn&apos;t load recurring items from Supabase right now. Check that
          `households` and `recurring_items` are available, then try again.
        </div>
      ) : null}

      {!loadError && recurringItems.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No recurring items were found for the first household in Supabase yet.
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Estimated monthly income</p>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(monthlyIncome)}</p>
              <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">Bi-weekly items are normalized to a monthly average.</p>
            </article>

            <article className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-sm text-rose-700 dark:text-rose-300">Estimated monthly expenses</p>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(monthlyExpenses)}</p>
              <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-300/80">{expenseItems.length} recurring expense items tracked.</p>
            </article>

            <article className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Estimated monthly net</p>
              <p className={`mt-2 text-2xl font-semibold ${monthlyNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {formatCurrency(monthlyNet)}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">This is an estimate from the recurring schedule only.</p>
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
            <article className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Income</h2>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {incomeItems.length} items
                </span>
              </div>

              <ul className="mt-4 space-y-3">
                {incomeItems.map((item) => (
                  <li key={item.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {item.groupName} • {item.frequency} • {formatDueDay(item.dueDay)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(item.amount)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(toMonthlyAmount(item))}/mo
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Expenses by Group</h2>
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {expenseItems.length} items
                </span>
              </div>

              <div className="mt-4 space-y-5">
                {groupedExpenses.map(([groupName, items]) => {
                  const groupMonthlyTotal = items.reduce(
                    (sum, item) => sum + toMonthlyAmount(item),
                    0,
                  );

                  return (
                    <section key={groupName} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        <div>
                          <h3 className="font-medium">{groupName}</h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {items.length} recurring items
                          </p>
                        </div>
                        <p className="font-mono text-sm">{formatCurrency(groupMonthlyTotal)}/mo</p>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-50 dark:bg-zinc-900/60">
                            <tr>
                              <th className="px-4 py-3 font-medium">Name</th>
                              <th className="px-4 py-3 font-medium">Frequency</th>
                              <th className="px-4 py-3 font-medium">Due</th>
                              <th className="px-4 py-3 font-medium">Amount</th>
                              <th className="px-4 py-3 font-medium">Monthly Est.</th>
                              <th className="px-4 py-3 font-medium">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.id} className="border-t border-zinc-200 dark:border-zinc-800">
                                <td className="px-4 py-3 font-medium">{item.name}</td>
                                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.frequency}</td>
                                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDueDay(item.dueDay)}</td>
                                <td className="px-4 py-3 font-mono">{formatCurrency(item.amount)}</td>
                                <td className="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">
                                  {formatCurrency(toMonthlyAmount(item))}
                                </td>
                                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.notes ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
