"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildReadableImportedAccountName,
  findClosestTransactionNameSuggestions,
  formatImportedDisplayLabel,
  findMatchingAccount,
  findMatchingCategory,
  normalizeImportedAmount,
  normalizeImportedTransaction,
  requiresTransactionNameReview,
  transactionTypeOptions,
} from "@/lib/imports/normalization";
import {
  approveImportedTransaction,
  approveImportedTransactionsBatch,
  saveImportedTransactionNameReview,
  saveImportedTransactionTypeReview,
} from "./actions";
import { ApproveImportButton } from "./approve-import-button";
import { BatchApproveButton } from "./batch-approve-button";
import { SaveReviewButton } from "./save-review-button";
import { SaveTypeButton } from "./save-type-button";

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

type StagedTransactionsTableProps = {
  initialTransactions: ImportedTransactionRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  existingTransactionNames?: string[];
  batchFormId: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function normalizeAmount(transaction: ImportedTransactionRow) {
  return normalizeImportedAmount(transaction);
}

export function StagedTransactionsTable({
  initialTransactions,
  accounts,
  categories,
  existingTransactionNames = [],
  batchFormId,
}: StagedTransactionsTableProps) {
  const selectableTransactionIds = useMemo(
    () =>
      initialTransactions
        .filter((transaction) => !requiresTransactionNameReview(transaction))
        .map((transaction) => transaction.id),
    [initialTransactions],
  );
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>(
    selectableTransactionIds,
  );
  const selectAllRef = useRef<HTMLInputElement>(null);
  const totalImportedAmount = initialTransactions.reduce((sum, transaction) => {
    const amount = normalizeAmount(transaction);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const allSelectableRowsChecked =
    selectableTransactionIds.length > 0 &&
    selectedTransactionIds.length === selectableTransactionIds.length;
  const someSelectableRowsChecked =
    selectedTransactionIds.length > 0 &&
    selectedTransactionIds.length < selectableTransactionIds.length;

  useEffect(() => {
    setSelectedTransactionIds(selectableTransactionIds);
  }, [selectableTransactionIds]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableRowsChecked;
    }
  }, [someSelectableRowsChecked]);

  function handleSelectAllChange(checked: boolean) {
    setSelectedTransactionIds(checked ? selectableTransactionIds : []);
  }

  function handleTransactionSelectionChange(transactionId: string, checked: boolean) {
    setSelectedTransactionIds((currentSelection) => {
      if (checked) {
        return currentSelection.includes(transactionId)
          ? currentSelection
          : [...currentSelection, transactionId];
      }

      return currentSelection.filter((selectedId) => selectedId !== transactionId);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Staged Transactions</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            The 25 most recent rows currently staged in `imported_transactions`.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Visible staged total</p>
          <p className="font-mono text-sm">{formatCurrency(totalImportedAmount)}</p>
        </div>
      </div>

      {initialTransactions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          No imported transactions have been staged yet.
        </p>
      ) : (
        <div className="mt-4">
          <form
            id={batchFormId}
            action={approveImportedTransactionsBatch}
            className="mb-3 flex items-center justify-between gap-3"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Select staged rows with the checkboxes, then approve them together.
            </p>
            <BatchApproveButton />
          </form>

          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-24" />
              <col className="w-[26%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-zinc-50 dark:bg-zinc-900/60">
              <tr>
                <th className="px-2 py-3 text-center font-medium">
                  <label className="flex items-center justify-center">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelectableRowsChecked}
                      onChange={(event) => handleSelectAllChange(event.target.checked)}
                      disabled={selectableTransactionIds.length === 0}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="sr-only">Select all</span>
                  </label>
                </th>
                <th className="px-2 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Normalized Transaction</th>
                <th className="px-3 py-3 font-medium">Account</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-2 py-3 font-medium">Type</th>
                <th className="px-2 py-3 font-medium">Source</th>
                <th className="px-2 py-3 font-medium">Amount</th>
                <th className="px-2 py-3 text-right font-medium">Approve</th>
              </tr>
            </thead>
            <tbody>
              {initialTransactions.map((transaction) => {
                const amount = normalizeAmount(transaction);
                const normalized = normalizeImportedTransaction(transaction);
                const needsNameReview = requiresTransactionNameReview(transaction);
                const similarImportedTransactions = initialTransactions.filter(
                  (candidate) =>
                    candidate.institution_name === transaction.institution_name &&
                    candidate.account_name === transaction.account_name &&
                    candidate.account_type === transaction.account_type,
                );
                const readableAccountName = buildReadableImportedAccountName(
                  normalized,
                  similarImportedTransactions,
                  accounts,
                );
                const accountMatch = findMatchingAccount(accounts, normalized);
                const categoryMatch = findMatchingCategory(categories, normalized);
                const rawDisplayName =
                  transaction.custom_name?.trim() || transaction.merchant_name;
                const accountLabel = [normalized.institutionName, readableAccountName]
                  .filter(Boolean)
                  .join(" • ");
                const categoryLabel = normalized.categoryName ?? "Uncategorized";
                const accountStatus = accountMatch
                  ? "Matches existing account"
                  : "Creates account on approval";
                const categoryStatus = normalized.categoryName
                  ? categoryMatch
                    ? "Matches existing category"
                    : "Creates category on approval"
                  : "Leaves transaction uncategorized";
                const reviewedNameValue =
                  transaction.custom_name?.trim() || rawDisplayName;
                const suggestedTransactionNames = findClosestTransactionNameSuggestions(
                  rawDisplayName,
                  existingTransactionNames,
                );
                const reviewNameOptions = Array.from(
                  new Set([reviewedNameValue, ...suggestedTransactionNames].filter(Boolean)),
                );

                return (
                  <tr
                    key={transaction.id}
                    id={`staged-transaction-${transaction.id}`}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    <td className="px-2 py-3 text-center align-top">
                      {selectedTransactionIds.includes(transaction.id) ? (
                        <input
                          type="hidden"
                          name="importedTransactionIds"
                          value={transaction.id}
                          form={batchFormId}
                        />
                      ) : null}
                      <input
                        type="checkbox"
                        checked={selectedTransactionIds.includes(transaction.id)}
                        onChange={(event) =>
                          handleTransactionSelectionChange(
                            transaction.id,
                            event.target.checked,
                          )
                        }
                        disabled={needsNameReview}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td className="truncate px-2 py-3 text-zinc-600 dark:text-zinc-400">
                      {transaction.transaction_date}
                    </td>
                    <td className="max-w-0 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={normalized.transactionName}>
                          {normalized.transactionName}
                        </p>
                        <p
                          className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                          title={formatImportedDisplayLabel(rawDisplayName)}
                        >
                          Raw: {formatImportedDisplayLabel(rawDisplayName)}
                        </p>
                        {transaction.description ? (
                          <p
                            className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                            title={transaction.description}
                          >
                            Memo: {transaction.description}
                          </p>
                        ) : null}
                        {needsNameReview ? (
                          <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            Please validate this transaction name mapping before approval.
                          </div>
                        ) : null}
                        {needsNameReview ? (
                          <form
                            action={saveImportedTransactionNameReview}
                            className="mt-2 grid grid-cols-1 gap-2"
                          >
                            <input
                              type="hidden"
                              name="importedTransactionId"
                              value={transaction.id}
                            />
                            <select
                              name="reviewedName"
                              defaultValue={reviewedNameValue}
                              className="min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {reviewNameOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <SaveReviewButton />
                          </form>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-0 px-3 py-3">
                      <p
                        className="truncate text-zinc-600 dark:text-zinc-400"
                        title={accountLabel || "—"}
                      >
                        {accountLabel || "—"}
                      </p>
                      <p
                        className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                        title={accountStatus}
                      >
                        {accountStatus}
                      </p>
                    </td>
                    <td className="max-w-0 px-3 py-3">
                      <p
                        className="truncate text-zinc-600 dark:text-zinc-400"
                        title={categoryLabel}
                      >
                        {categoryLabel}
                      </p>
                      <p
                        className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                        title={categoryStatus}
                      >
                        {categoryStatus}
                      </p>
                    </td>
                    <td className="max-w-0 px-2 py-3 text-zinc-600 capitalize dark:text-zinc-400">
                      <div className="min-w-0 space-y-2">
                        <p className="truncate" title={normalized.transactionType}>
                          {normalized.transactionType}
                        </p>
                        <form
                          action={saveImportedTransactionTypeReview}
                          className="grid grid-cols-1 gap-2"
                        >
                          <input
                            type="hidden"
                            name="importedTransactionId"
                            value={transaction.id}
                          />
                          <select
                            name="reviewedTransactionType"
                            defaultValue={normalized.transactionType}
                            className="min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            {transactionTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <SaveTypeButton />
                        </form>
                      </div>
                    </td>
                    <td className="max-w-0 px-2 py-3 text-zinc-600 dark:text-zinc-400">
                      <p className="truncate" title={transaction.source}>
                        {transaction.source}
                      </p>
                    </td>
                    <td className="truncate px-2 py-3 font-mono">
                      <span
                        className={
                          amount >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-zinc-900 dark:text-zinc-100"
                        }
                      >
                        {formatCurrency(amount)}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <form action={approveImportedTransaction}>
                        <input
                          type="hidden"
                          name="importedTransactionId"
                          value={transaction.id}
                        />
                        <ApproveImportButton disabled={needsNameReview} />
                      </form>
                      {needsNameReview ? (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          Approval is blocked until the name is reviewed.
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
