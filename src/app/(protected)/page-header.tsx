import Link from "next/link";
import { signOut } from "./actions";

type PageHeaderProps = {
  title: string;
  description?: string;
  email: string;
};

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
  { href: "/imports", label: "Imports" },
  { href: "/recurring", label: "Recurring" },
  { href: "/transactions", label: "Transactions" },
];

export function PageHeader({ title, description, email }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {description}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
        <nav className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              className="rounded-md border px-3 py-1.5"
              href={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          {email}
        </p>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
