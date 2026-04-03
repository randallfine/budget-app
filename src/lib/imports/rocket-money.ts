import crypto from "node:crypto";

export const rocketMoneyHeaders = [
  "Date",
  "Original Date",
  "Account Type",
  "Account Name",
  "Account Number",
  "Institution Name",
  "Name",
  "Custom Name",
  "Amount",
  "Description",
  "Category",
  "Note",
  "Ignored From",
  "Tax Deductible",
  "Transaction Tags",
] as const;

export type RocketMoneyHeader = (typeof rocketMoneyHeaders)[number];

export type RocketMoneyCsvRow = Record<RocketMoneyHeader, string>;

export type ImportedTransaction = {
  source: "rocket-money";
  externalId: string;
  date: string;
  originalDate: string | null;
  accountType: string | null;
  accountName: string | null;
  accountNumber: string | null;
  institutionName: string | null;
  merchantName: string;
  customName: string | null;
  amount: number;
  description: string | null;
  category: string | null;
  note: string | null;
  ignoredFrom: string | null;
  taxDeductible: boolean;
  transactionTags: string[];
  rawData: RocketMoneyCsvRow;
};

function normalizeLineEndings(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  const normalized = normalizeLineEndings(text);
  let currentRow: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(current);
      current = "";
      continue;
    }

    if (character === "\n" && !inQuotes) {
      currentRow.push(current);

      if (currentRow.some((value) => value.trim() !== "")) {
        rows.push(currentRow);
      }

      currentRow = [];
      current = "";
      continue;
    }

    current += character;
  }

  currentRow.push(current);

  if (currentRow.some((value) => value.trim() !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

function assertHeaders(headers: string[]) {
  if (headers.length !== rocketMoneyHeaders.length) {
    throw new Error("The CSV does not match the expected Rocket Money column count.");
  }

  const mismatches = rocketMoneyHeaders.filter(
    (header, index) => headers[index] !== header,
  );

  if (mismatches.length > 0) {
    throw new Error("The CSV headers do not match the Rocket Money export format.");
  }
}

function nullIfBlank(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function parseBoolean(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function parseAmount(value: string) {
  const trimmed = value.trim();
  const isNegative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[,$()]/g, "");
  const amount = Number.parseFloat(cleaned);

  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount: ${value}`);
  }

  return isNegative ? -amount : amount;
}

function parseTags(value: string | undefined) {
  const raw = (value ?? "").trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildExternalId(row: RocketMoneyCsvRow) {
  const base = [
    row.Date,
    row["Original Date"],
    row["Account Name"],
    row["Account Number"],
    row["Institution Name"],
    row.Name,
    row["Custom Name"],
    row.Amount,
    row.Description,
  ].join("|");

  return crypto.createHash("sha256").update(base).digest("hex");
}

export function parseRocketMoneyCsv(csvText: string): ImportedTransaction[] {
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    throw new Error("The CSV is empty or missing transaction rows.");
  }

  const [headerRow, ...dataRows] = rows;
  assertHeaders(headerRow);

  return dataRows.map((values, rowIndex) => {
    if (values.length !== rocketMoneyHeaders.length) {
      throw new Error(`Row ${rowIndex + 2} does not have the expected 15 columns.`);
    }

    const row = Object.fromEntries(
      rocketMoneyHeaders.map((header, index) => [header, values[index] ?? ""]),
    ) as RocketMoneyCsvRow;

    const merchantName = row.Name.trim();

    if (!merchantName) {
      throw new Error(`Row ${rowIndex + 2} is missing a transaction name.`);
    }

    return {
      source: "rocket-money",
      externalId: buildExternalId(row),
      date: row.Date.trim(),
      originalDate: nullIfBlank(row["Original Date"]),
      accountType: nullIfBlank(row["Account Type"]),
      accountName: nullIfBlank(row["Account Name"]),
      accountNumber: nullIfBlank(row["Account Number"]),
      institutionName: nullIfBlank(row["Institution Name"]),
      merchantName,
      customName: nullIfBlank(row["Custom Name"]),
      amount: parseAmount(row.Amount),
      description: nullIfBlank(row.Description),
      category: nullIfBlank(row.Category),
      note: nullIfBlank(row.Note),
      ignoredFrom: nullIfBlank(row["Ignored From"]),
      taxDeductible: parseBoolean(row["Tax Deductible"]),
      transactionTags: parseTags(row["Transaction Tags"]),
      rawData: row,
    };
  });
}
