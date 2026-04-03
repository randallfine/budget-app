"use client";

import { useFormStatus } from "react-dom";

export function SaveReviewButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
    >
      {pending ? "Saving..." : "Save Name"}
    </button>
  );
}
