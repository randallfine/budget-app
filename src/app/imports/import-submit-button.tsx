"use client";

import { useFormStatus } from "react-dom";

type ImportSubmitButtonProps = {
  disabled?: boolean;
};

export function ImportSubmitButton({ disabled = false }: ImportSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <div className="space-y-2">
      <button
        type="submit"
        disabled={isDisabled}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
      >
        {pending ? "Uploading CSV..." : "Import CSV"}
      </button>

      {pending ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uploading and staging transactions. This can take a few seconds.
        </p>
      ) : null}
    </div>
  );
}
