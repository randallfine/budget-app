import {
  buildReadableImportedAccountName,
  normalizeImportedTransaction,
} from "@/lib/imports/normalization";

type ImportedTransactionLike = {
  id: string;
  transaction_date: string;
  amount: number | string;
  merchant_name: string;
  custom_name: string | null;
  description: string | null;
  note: string | null;
  category: string | null;
  institution_name: string | null;
  account_name: string | null;
  account_number?: string | null;
  account_type: string | null;
  source: string;
  external_id: string;
};

type AccountLike = {
  id: string;
  name: string;
  institution: string | null;
  type: string;
};

type FrequencyUnit = "day" | "week" | "month" | "year";

export type RecurringCandidate = {
  key: string;
  name: string;
  accountLabel: string;
  amount: number;
  occurrences: number;
  firstSeenDate: string;
  lastSeenDate: string;
  nextExpectedDate: string | null;
  everyValue: number;
  everyUnit: FrequencyUnit;
  cadenceLabel: string;
  intervalDays: number;
  confidence: "high" | "medium";
  endDate: string | null;
  remainingPayments: number | null;
  totalPayments: number | null;
  paymentsCompleted: number | null;
  needsValidation: boolean;
  validationReason: string | null;
};

type InstallmentProgress = {
  currentPayment: number;
  totalPayments: number;
};

function toNumber(value: number | string) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function diffInDays(earlier: Date, later: Date) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((later.getTime() - earlier.getTime()) / msPerDay);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inferFrequency(intervalDays: number) {
  if (intervalDays >= 360) {
    return {
      everyValue: Math.max(1, Math.round(intervalDays / 365)),
      everyUnit: "year" as const,
      cadenceLabel: intervalDays >= 720 ? `Every ${Math.round(intervalDays / 365)} years` : "Every year",
    };
  }

  if (intervalDays >= 26) {
    const approxMonths = Math.max(1, Math.round(intervalDays / 30));
    return {
      everyValue: approxMonths,
      everyUnit: "month" as const,
      cadenceLabel: approxMonths === 1 ? "Every month" : `Every ${approxMonths} months`,
    };
  }

  if (intervalDays >= 7) {
    const approxWeeks = Math.max(1, Math.round(intervalDays / 7));
    return {
      everyValue: approxWeeks,
      everyUnit: "week" as const,
      cadenceLabel: approxWeeks === 1 ? "Every week" : `Every ${approxWeeks} weeks`,
    };
  }

  return {
    everyValue: Math.max(1, intervalDays),
    everyUnit: "day" as const,
    cadenceLabel: intervalDays <= 1 ? "Every day" : `Every ${intervalDays} days`,
  };
}

function addFrequency(date: Date, everyValue: number, everyUnit: FrequencyUnit) {
  const nextDate = new Date(date);

  if (everyUnit === "day") {
    nextDate.setUTCDate(nextDate.getUTCDate() + everyValue);
    return nextDate;
  }

  if (everyUnit === "week") {
    nextDate.setUTCDate(nextDate.getUTCDate() + everyValue * 7);
    return nextDate;
  }

  if (everyUnit === "month") {
    nextDate.setUTCMonth(nextDate.getUTCMonth() + everyValue);
    return nextDate;
  }

  nextDate.setUTCFullYear(nextDate.getUTCFullYear() + everyValue);
  return nextDate;
}

function extractInstallmentProgress(transaction: ImportedTransactionLike): InstallmentProgress | null {
  const searchable = [
    transaction.custom_name,
    transaction.merchant_name,
    transaction.description,
    transaction.note,
  ]
    .filter(Boolean)
    .join(" ");

  const slashMatch = searchable.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);

  if (slashMatch) {
    const currentPayment = Number.parseInt(slashMatch[1] ?? "", 10);
    const totalPayments = Number.parseInt(slashMatch[2] ?? "", 10);

    if (currentPayment > 0 && totalPayments >= currentPayment) {
      return { currentPayment, totalPayments };
    }
  }

  const ofMatch = searchable.match(/\b(\d{1,3})\s+of\s+(\d{1,3})\b/i);

  if (ofMatch) {
    const currentPayment = Number.parseInt(ofMatch[1] ?? "", 10);
    const totalPayments = Number.parseInt(ofMatch[2] ?? "", 10);

    if (currentPayment > 0 && totalPayments >= currentPayment) {
      return { currentPayment, totalPayments };
    }
  }

  return null;
}

function isConsistentRecurringPattern(sortedTransactions: ImportedTransactionLike[]) {
  if (sortedTransactions.length < 2) {
    return null;
  }

  const intervals: number[] = [];

  for (let index = 1; index < sortedTransactions.length; index += 1) {
    const previousDate = parseDate(sortedTransactions[index - 1].transaction_date);
    const currentDate = parseDate(sortedTransactions[index].transaction_date);
    const diff = diffInDays(previousDate, currentDate);

    if (diff > 0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) {
    return null;
  }

  const averageInterval = average(intervals);
  const maxVariance = Math.max(
    ...intervals.map((interval) => Math.abs(interval - averageInterval)),
  );

  if (sortedTransactions.length >= 3 && maxVariance > Math.max(3, averageInterval * 0.2)) {
    return null;
  }

  if (sortedTransactions.length < 3 && averageInterval > 45) {
    return null;
  }

  return Math.max(1, Math.round(averageInterval));
}

export function findRecurringCandidates(
  importedTransactions: ImportedTransactionLike[],
  existingAccounts: AccountLike[],
) {
  const groupedTransactions = new Map<string, ImportedTransactionLike[]>();

  for (const transaction of importedTransactions) {
    const normalized = normalizeImportedTransaction(transaction);
    const sameAccountTransactions = importedTransactions.filter(
      (candidate) =>
        candidate.institution_name === transaction.institution_name &&
        candidate.account_name === transaction.account_name &&
        candidate.account_type === transaction.account_type,
    );
    const readableAccountName = buildReadableImportedAccountName(
      normalized,
      sameAccountTransactions,
      existingAccounts,
    );
    const amount = Math.abs(toNumber(transaction.amount));
    const key = [
      normalized.transactionName.toLowerCase(),
      readableAccountName.toLowerCase(),
      Math.sign(toNumber(transaction.amount)),
      amount.toFixed(2),
    ].join("|");
    const currentGroup = groupedTransactions.get(key) ?? [];

    currentGroup.push(transaction);
    groupedTransactions.set(key, currentGroup);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [key, group] of groupedTransactions.entries()) {
    if (group.length < 2) {
      continue;
    }

    const sortedGroup = [...group].sort((left, right) =>
      left.transaction_date.localeCompare(right.transaction_date),
    );
    const intervalDays = isConsistentRecurringPattern(sortedGroup);

    if (!intervalDays) {
      continue;
    }

    const normalized = normalizeImportedTransaction(sortedGroup[0]);
    const readableAccountName = buildReadableImportedAccountName(
      normalized,
      group,
      existingAccounts,
    );
    const frequency = inferFrequency(intervalDays);
    const lastSeenDate = parseDate(sortedGroup[sortedGroup.length - 1].transaction_date);
    const nextExpectedDate = addFrequency(
      lastSeenDate,
      frequency.everyValue,
      frequency.everyUnit,
    );
    const installmentProgress = [...sortedGroup]
      .reverse()
      .map(extractInstallmentProgress)
      .find((progress): progress is InstallmentProgress => progress !== null);
    const remainingPayments = installmentProgress
      ? installmentProgress.totalPayments - installmentProgress.currentPayment
      : null;
    const endDate =
      remainingPayments && remainingPayments > 0
        ? formatDate(
            addFrequency(
              lastSeenDate,
              frequency.everyValue * remainingPayments,
              frequency.everyUnit,
            ),
          )
        : remainingPayments === 0
          ? sortedGroup[sortedGroup.length - 1].transaction_date
          : null;
    const confidence = sortedGroup.length >= 3 ? "high" : "medium";
    let validationReason: string | null = null;

    if (confidence !== "high") {
      validationReason = "Cadence was inferred from limited history. Please validate the repeat schedule.";
    } else if (installmentProgress === null) {
      validationReason = "A payoff/end date could not be inferred from the imported text. Please validate it manually if this is a fixed-term payment.";
    }

    candidates.push({
      key,
      name: normalized.transactionName,
      accountLabel: [normalized.institutionName, readableAccountName]
        .filter(Boolean)
        .join(" • "),
      amount: toNumber(sortedGroup[sortedGroup.length - 1].amount),
      occurrences: sortedGroup.length,
      firstSeenDate: sortedGroup[0].transaction_date,
      lastSeenDate: sortedGroup[sortedGroup.length - 1].transaction_date,
      nextExpectedDate: formatDate(nextExpectedDate),
      everyValue: frequency.everyValue,
      everyUnit: frequency.everyUnit,
      cadenceLabel: frequency.cadenceLabel,
      intervalDays,
      confidence,
      endDate,
      remainingPayments,
      totalPayments: installmentProgress?.totalPayments ?? null,
      paymentsCompleted: installmentProgress?.currentPayment ?? null,
      needsValidation: validationReason !== null,
      validationReason,
    });
  }

  return candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return left.confidence === "high" ? -1 : 1;
    }

    if (left.nextExpectedDate && right.nextExpectedDate) {
      return left.nextExpectedDate.localeCompare(right.nextExpectedDate);
    }

    return left.name.localeCompare(right.name);
  });
}
