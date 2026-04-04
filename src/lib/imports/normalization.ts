type ImportedTransactionLike = {
  source: string;
  external_id: string;
  amount: number | string;
  merchant_name: string;
  custom_name: string | null;
  description: string | null;
  category: string | null;
  note: string | null;
  institution_name: string | null;
  account_name: string | null;
  account_number?: string | null;
  account_type: string | null;
  reviewed_transaction_type?: string | null;
};

export const transactionTypeOptions = [
  "debit",
  "deposit",
  "transfer",
  "credit",
  "refund",
  "fee",
  "withdrawal",
] as const;

export type TransactionTypeOption = (typeof transactionTypeOptions)[number];

type AccountLike = {
  id: string;
  name: string;
  institution: string | null;
  type: string;
};

type CategoryLike = {
  id: string;
  name: string;
  kind: string;
};

type ExistingTransactionLike = {
  description: string | null;
  notes: string | null;
};

const LEADING_TRANSACTION_PREFIXES = [
  /^(?:debit card purchase|recurring card purchase|visa purchase)\s+/i,
  /^(?:pos purchase|pos|dbt purchase|dbt|purchase)\s+/i,
  /^(?:checkcard|ach debit|ach credit|withdrawal|deposit|payment)\s+/i,
];

const UPPERCASE_ACRONYMS = new Set(["ACH", "ATM", "HSA", "IRA", "POS", "USA", "USD"]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toNumber(value: number | string) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCaseWord(word: string) {
  if (!/[a-z]/i.test(word)) {
    return word;
  }

  if (UPPERCASE_ACRONYMS.has(word.toUpperCase())) {
    return word.toUpperCase();
  }

  if (/^\d+$/.test(word)) {
    return word;
  }

  if (/^[A-Z0-9&/-]+$/.test(word) && word.length <= 4) {
    return word.toUpperCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseLabel(value: string) {
  return value
    .split(/(\s+|[&/()-])/)
    .map((segment) => {
      if (!segment || /(\s+|[&/()-])/.test(segment)) {
        return segment;
      }

      return titleCaseWord(segment);
    })
    .join("");
}

function cleanDisplayLabel(value: string) {
  const normalized = normalizeWhitespace(
    value.replace(/[_*]+/g, " ").replace(/\s+-\s+/g, " "),
  );

  if (!normalized) {
    return "";
  }

  return titleCaseLabel(normalized);
}

export function formatImportedDisplayLabel(value: string) {
  return cleanDisplayLabel(value);
}

function cleanTransactionName(value: string) {
  let cleaned = normalizeWhitespace(
    value
      .replace(/[_*]+/g, " ")
      .replace(/\s{2,}/g, " "),
  );

  let changed = true;

  while (changed) {
    changed = false;

    for (const prefix of LEADING_TRANSACTION_PREFIXES) {
      if (prefix.test(cleaned)) {
        cleaned = cleaned.replace(prefix, "");
        changed = true;
      }
    }
  }

  cleaned = cleaned.replace(/\s+#?\d{5,}\b/g, " ");
  cleaned = normalizeWhitespace(cleaned);

  return cleanDisplayLabel(cleaned);
}

function normalizeAccountNumber(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D+/g, "");
  return digits || null;
}

function getAccountNumberSuffix(value: string | null | undefined) {
  const digits = normalizeAccountNumber(value);

  if (!digits) {
    return null;
  }

  return digits.slice(-4);
}

export function canonicalizeForMatch(value: string | null | undefined) {
  return normalizeWhitespace(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function normalizeAccountType(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "").toLowerCase();

  if (!normalized) {
    return "checking";
  }

  if (normalized.includes("credit")) {
    return "credit";
  }

  if (normalized.includes("saving")) {
    return "savings";
  }

  if (normalized.includes("check")) {
    return "checking";
  }

  if (normalized.includes("invest") || normalized.includes("brokerage")) {
    return "investment";
  }

  if (normalized.includes("loan") || normalized.includes("mortgage")) {
    return "loan";
  }

  if (normalized.includes("cash")) {
    return "cash";
  }

  return normalized.replace(/\s+/g, "_");
}

export function inferTransactionType(transaction: ImportedTransactionLike) {
  const reviewedType = normalizeWhitespace(transaction.reviewed_transaction_type ?? "").toLowerCase();

  if (
    reviewedType &&
    transactionTypeOptions.includes(reviewedType as TransactionTypeOption)
  ) {
    return reviewedType as TransactionTypeOption;
  }

  const amount = toNumber(transaction.amount);
  const searchable = [
    transaction.category,
    transaction.description,
    transaction.custom_name,
    transaction.merchant_name,
    transaction.note,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /(internal transfer|transfer to|transfer from|to checking|to savings|from checking|from savings|autosave transfer|move money)/.test(
      searchable,
    )
  ) {
    return "transfer";
  }

  if (amount > 0) {
    if (/(refund|reversal|return)/.test(searchable)) {
      return "refund";
    }

    if (/(interest|dividend|reward|cash back)/.test(searchable)) {
      return "credit";
    }

    return "deposit";
  }

  if (/(transfer|payment)/.test(searchable)) {
    return "transfer";
  }

  if (/(fee|service charge|overdraft)/.test(searchable)) {
    return "fee";
  }

  if (/(atm|withdrawal)/.test(searchable)) {
    return "withdrawal";
  }

  return "debit";
}

export function inferCategoryKind(transaction: ImportedTransactionLike) {
  const type = inferTransactionType(transaction);

  if (type === "deposit" || type === "credit" || type === "refund") {
    return "income";
  }

  if (type === "transfer") {
    return "expense";
  }

  return "expense";
}

export function normalizeImportedTransaction(transaction: ImportedTransactionLike) {
  const transactionName = cleanTransactionName(
    transaction.custom_name?.trim() ||
      transaction.merchant_name ||
      transaction.description ||
      "Imported transaction",
  );
  const institutionName = transaction.institution_name
    ? cleanDisplayLabel(transaction.institution_name)
    : null;
  const accountName = transaction.account_name
    ? cleanDisplayLabel(transaction.account_name)
    : "Imported Account";
  const accountNumberSuffix = getAccountNumberSuffix(transaction.account_number);
  const accountType = normalizeAccountType(transaction.account_type);
  const categoryName = transaction.category ? cleanDisplayLabel(transaction.category) : null;
  const transactionType = inferTransactionType(transaction);
  const categoryKind = inferCategoryKind(transaction);

  return {
    transactionName,
    institutionName,
    accountName,
    accountNumberSuffix,
    accountType,
    categoryName,
    categoryKind,
    transactionType,
    matchableDescription: canonicalizeForMatch(transactionName),
  };
}

export function requiresTransactionNameReview(transaction: ImportedTransactionLike) {
  if (transaction.custom_name?.trim()) {
    return false;
  }

  const normalized = normalizeImportedTransaction(transaction);
  const rawDisplayName = formatImportedDisplayLabel(
    transaction.merchant_name || transaction.description || "Imported transaction",
  );

  if (canonicalizeForMatch(normalized.transactionName) !== canonicalizeForMatch(rawDisplayName)) {
    return true;
  }

  return /[*#]\w|\d{5,}|autopay|payment|interest charge|returned ach/i.test(
    transaction.merchant_name,
  );
}

function splitDisambiguatedAccountName(value: string | null | undefined) {
  const label = normalizeWhitespace(value ?? "");
  const match = label.match(/^(.*?)(?:\s+•\s+(\d{4}))$/);

  if (!match) {
    return {
      baseName: label,
      suffix: null as string | null,
    };
  }

  return {
    baseName: normalizeWhitespace(match[1] ?? ""),
    suffix: match[2] ?? null,
  };
}

function buildAccountIdentityKey(
  institutionName: string | null | undefined,
  accountName: string | null | undefined,
  accountType: string | null | undefined,
) {
  return [
    canonicalizeForMatch(institutionName),
    canonicalizeForMatch(accountName),
    canonicalizeForMatch(accountType),
  ].join(":");
}

export function buildReadableImportedAccountName(
  normalized: ReturnType<typeof normalizeImportedTransaction>,
  similarImportedTransactions: ImportedTransactionLike[],
  existingAccounts: AccountLike[] = [],
) {
  const importedIdentityCounts = new Map<string, Set<string>>();

  for (const transaction of similarImportedTransactions) {
    const candidate = normalizeImportedTransaction(transaction);
    const key = buildAccountIdentityKey(
      candidate.institutionName,
      candidate.accountName,
      candidate.accountType,
    );
    const suffixes = importedIdentityCounts.get(key) ?? new Set<string>();

    if (candidate.accountNumberSuffix) {
      suffixes.add(candidate.accountNumberSuffix);
    }

    importedIdentityCounts.set(key, suffixes);
  }

  for (const account of existingAccounts) {
    const { baseName, suffix } = splitDisambiguatedAccountName(account.name);
    const key = buildAccountIdentityKey(
      account.institution,
      baseName,
      normalizeAccountType(account.type),
    );
    const suffixes = importedIdentityCounts.get(key) ?? new Set<string>();

    if (suffix) {
      suffixes.add(suffix);
    }

    importedIdentityCounts.set(key, suffixes);
  }

  const currentKey = buildAccountIdentityKey(
    normalized.institutionName,
    normalized.accountName,
    normalized.accountType,
  );
  const distinctSuffixes = importedIdentityCounts.get(currentKey) ?? new Set<string>();
  const shouldDisambiguate =
    Boolean(normalized.accountNumberSuffix) && distinctSuffixes.size > 1;

  if (!shouldDisambiguate) {
    return normalized.accountName;
  }

  return `${normalized.accountName} • ${normalized.accountNumberSuffix}`;
}

export function findMatchingAccount(
  accounts: AccountLike[],
  normalized: ReturnType<typeof normalizeImportedTransaction>,
) {
  const targetName = canonicalizeForMatch(normalized.accountName);
  const targetSuffix = normalized.accountNumberSuffix;
  const targetInstitution = canonicalizeForMatch(normalized.institutionName);

  return (
    accounts.find((account) => {
      const { baseName, suffix } = splitDisambiguatedAccountName(account.name);
      const sameName = canonicalizeForMatch(baseName) === targetName;
      const sameInstitution =
        canonicalizeForMatch(account.institution) === targetInstitution;
      const sameType = normalizeAccountType(account.type) === normalized.accountType;
      const sameSuffix = targetSuffix ? suffix === targetSuffix : true;

      return sameName && sameInstitution && sameType && sameSuffix;
    }) ??
    accounts.find((account) => {
      const { baseName } = splitDisambiguatedAccountName(account.name);
      return canonicalizeForMatch(baseName) === targetName;
    }) ??
    null
  );
}

export function findMatchingCategory(
  categories: CategoryLike[],
  normalized: ReturnType<typeof normalizeImportedTransaction>,
) {
  if (!normalized.categoryName) {
    return null;
  }

  const targetName = canonicalizeForMatch(normalized.categoryName);

  return (
    categories.find((category) => {
      return (
        canonicalizeForMatch(category.name) === targetName &&
        canonicalizeForMatch(category.kind) === canonicalizeForMatch(normalized.categoryKind)
      );
    }) ??
    categories.find((category) => canonicalizeForMatch(category.name) === targetName) ??
    null
  );
}

export function buildImportDeduplicationToken(source: string, externalId: string) {
  return `[import:${source}:${externalId}]`;
}

export function buildTransactionNotes(
  transaction: ImportedTransactionLike,
  normalized: ReturnType<typeof normalizeImportedTransaction>,
) {
  const metadataLines = [
    buildImportDeduplicationToken(transaction.source, transaction.external_id),
    `Imported from ${titleCaseLabel(transaction.source.replace(/-/g, " "))}`,
    `Normalized transaction type: ${normalized.transactionType}`,
  ];

  if (
    transaction.custom_name?.trim() &&
    transaction.custom_name.trim() !== transaction.merchant_name.trim()
  ) {
    metadataLines.push(`Original merchant: ${transaction.merchant_name.trim()}`);
  }

  return [transaction.note?.trim(), metadataLines.join("\n")]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

export function matchesImportedTransaction(
  existingTransaction: ExistingTransactionLike,
  normalized: ReturnType<typeof normalizeImportedTransaction>,
  source: string,
  externalId: string,
) {
  const token = buildImportDeduplicationToken(source, externalId);

  if (existingTransaction.notes?.includes(token)) {
    return true;
  }

  return (
    canonicalizeForMatch(existingTransaction.description) === normalized.matchableDescription
  );
}
