import Link from "next/link";

export default function NotAuthorizedPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12 text-center">
      <div className="rounded-2xl border border-zinc-200 p-8 shadow-sm dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Access denied
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          You&apos;re not authorized for this workspace.
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Your account was signed out because your email is not on the allowlist.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700"
          >
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}
