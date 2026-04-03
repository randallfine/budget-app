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
  type: string;
  starting_balance: number | string;
  created_at: string;
};

export default async function AccountsPage() {
  const { adminSupabase, email, householdId } = await getAuthorizedPageContext();
  let accounts: AccountRow[] = [];
  let loadError = false;

  if (householdId) {
    try {
      const { data, error } = await adminSupabase
        .from("accounts")
        .select("id, name, institution, type, starting_balance, created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      accounts = (data ?? []) as AccountRow[];
    } catch (error) {
      loadError = true;
      console.error("Failed to load accounts:", error);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <PageHeader
        title="Accounts"
        description="Live account balances and institutions for the current household."
        email={email}
      />

      {loadError ? (
        <p className="mb-6 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          We couldn&apos;t load accounts right now.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Institution</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {!householdId ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-zinc-600 dark:text-zinc-400">
                  Create a household to start tracking accounts.
                </td>
              </tr>
            ) : null}

            {householdId && !loadError && accounts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-zinc-600 dark:text-zinc-400">
                  No accounts have been added yet.
                </td>
              </tr>
            ) : null}

            {accounts.map((account) => (
              <tr key={account.id} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-4 py-3">{account.name}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {account.institution || "Unknown institution"}
                </td>
                <td className="px-4 py-3 text-zinc-600 capitalize dark:text-zinc-400">
                  {account.type}
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatCurrency(toNumber(account.starting_balance))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
