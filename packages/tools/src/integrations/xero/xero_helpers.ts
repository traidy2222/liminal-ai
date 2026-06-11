/**
 * Shared helpers for Xero tool handlers (response parsing, account filters).
 */
import { xeroFetch, type XeroFetchOpts } from "./xero_api.js";

export function xeroEntityArray(data: unknown, key: string): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const arr = (data as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

export function xeroFirstEntity(data: unknown, key: string): Record<string, unknown> | null {
  return xeroEntityArray(data, key)[0] ?? null;
}

export async function xeroFetchEntity(
  path: string,
  key: string,
  opts: XeroFetchOpts = {}
): Promise<{ ok: true; entity: Record<string, unknown> } | { ok: false; error: string }> {
  const r = await xeroFetch(path, opts);
  if (!r.ok) return r;
  const entity = xeroFirstEntity(r.data, key);
  if (!entity) return { ok: false, error: `${key} not found in response` };
  return { ok: true, entity };
}

export function filterBankAccounts(accounts: Record<string, unknown>[]): Record<string, unknown>[] {
  return accounts.filter((a) => {
    const type = String(a["Type"] ?? "").toUpperCase();
    const klass = String(a["Class"] ?? "").toUpperCase();
    return type === "BANK" || klass === "ASSET";
  });
}

export function pickDefaultSalesLineDefaults(
  accounts: Record<string, unknown>[],
  taxRates: Record<string, unknown>[]
): { accountCode?: string; taxType?: string } {
  const revenue =
    accounts.find((a) => String(a["Type"] ?? "").toUpperCase() === "REVENUE") ??
    accounts.find((a) => String(a["Class"] ?? "").toUpperCase() === "REVENUE");
  const tax =
    taxRates.find((t) => String(t["ReportTaxType"] ?? "").toUpperCase() === "OUTPUT") ??
    taxRates.find((t) => String(t["TaxType"] ?? "").toUpperCase().includes("OUTPUT")) ??
    taxRates.find((t) => t["CanApplyToRevenue"] === true);
  return {
    accountCode: revenue?.["Code"] != null ? String(revenue["Code"]) : undefined,
    taxType: tax?.["TaxType"] != null ? String(tax["TaxType"]) : undefined,
  };
}

export function pickDefaultPurchaseLineDefaults(
  accounts: Record<string, unknown>[],
  taxRates: Record<string, unknown>[]
): { accountCode?: string; taxType?: string } {
  const expense =
    accounts.find((a) => String(a["Type"] ?? "").toUpperCase() === "EXPENSE") ??
    accounts.find((a) => String(a["Class"] ?? "").toUpperCase() === "EXPENSE") ??
    accounts.find((a) => String(a["Type"] ?? "").toUpperCase() === "DIRECTCOSTS");
  const tax =
    taxRates.find((t) => String(t["ReportTaxType"] ?? "").toUpperCase() === "INPUT") ??
    taxRates.find((t) => t["CanApplyToExpenses"] === true);
  return {
    accountCode: expense?.["Code"] != null ? String(expense["Code"]) : undefined,
    taxType: tax?.["TaxType"] != null ? String(tax["TaxType"]) : undefined,
  };
}

export function lineItemsFromEntity(entity: Record<string, unknown>): Record<string, unknown>[] {
  const items = entity["LineItems"];
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((line) => {
      const out: Record<string, unknown> = {};
      for (const k of [
        "Description",
        "Quantity",
        "UnitAmount",
        "AccountCode",
        "TaxType",
        "ItemCode",
        "LineItemID",
      ]) {
        if (line[k] !== undefined) out[k] = line[k];
      }
      return out;
    });
}

export function contactIdFromEntity(entity: Record<string, unknown>): string | undefined {
  const contact = entity["Contact"];
  if (!contact || typeof contact !== "object") return undefined;
  const id = (contact as Record<string, unknown>)["ContactID"];
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/** Project time entry date (YYYY-MM-DD) from dateUtc ISO string. */
export function projectTimeEntryDate(entry: Record<string, unknown>): string | undefined {
  const raw = entry["dateUtc"];
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.trim().slice(0, 10);
}

export function taskRateValue(task: Record<string, unknown>): number | undefined {
  const rate = task["rate"];
  if (!rate || typeof rate !== "object") return undefined;
  const v = (rate as Record<string, unknown>)["value"];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type ProjectTimeAggregateOpts = {
  fromDate?: string;
  toDate?: string;
  unbilledOnly?: boolean;
};

/**
 * Roll project time entries into invoice line items grouped by task.
 */
export function aggregateProjectTimeByTask(
  entries: Record<string, unknown>[],
  tasksById: Map<string, Record<string, unknown>>,
  opts: ProjectTimeAggregateOpts = {}
): { ok: true; lineItems: Record<string, unknown>[]; totalMinutes: number } | { ok: false; error: string } {
  const unbilledOnly = opts.unbilledOnly !== false;
  const buckets = new Map<string, { minutes: number; descriptions: string[] }>();
  let totalMinutes = 0;

  for (const entry of entries) {
    if (unbilledOnly && String(entry["status"] ?? "").toUpperCase() === "INVOICED") continue;
    const entryDate = projectTimeEntryDate(entry);
    if (opts.fromDate && entryDate && entryDate < opts.fromDate) continue;
    if (opts.toDate && entryDate && entryDate > opts.toDate) continue;
    const taskId = String(entry["taskId"] ?? "").trim();
    if (!taskId) continue;
    const mins = Number(entry["duration"]);
    if (!Number.isFinite(mins) || mins <= 0) continue;
    totalMinutes += mins;
    const bucket = buckets.get(taskId) ?? { minutes: 0, descriptions: [] };
    bucket.minutes += mins;
    const desc = entry["description"];
    if (typeof desc === "string" && desc.trim()) bucket.descriptions.push(desc.trim());
    buckets.set(taskId, bucket);
  }

  if (buckets.size === 0) {
    return { ok: false, error: "no billable time entries in range (check dates or unbilled_only)" };
  }

  const lineItems: Record<string, unknown>[] = [];
  for (const [taskId, bucket] of buckets) {
    const task = tasksById.get(taskId);
    const taskName = task ? String(task["name"] ?? taskId) : taskId;
    const rate = task ? taskRateValue(task) : undefined;
    const hours = Math.round((bucket.minutes / 60) * 100) / 100;
    const descParts = bucket.descriptions.slice(0, 3);
    const description =
      descParts.length > 0
        ? `${taskName}: ${descParts.join("; ")}${bucket.descriptions.length > 3 ? "…" : ""}`
        : `${taskName} (${hours}h)`;
    const line: Record<string, unknown> = {
      Description: description,
      Quantity: hours,
    };
    if (rate != null) line["UnitAmount"] = rate;
    lineItems.push(line);
  }

  return { ok: true, lineItems, totalMinutes };
}
