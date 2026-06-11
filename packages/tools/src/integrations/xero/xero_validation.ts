/**
 * Xero payload normalization + validation error formatting.
 */

const LINE_ITEM_KEYS: Record<string, string> = {
  description: "Description",
  quantity: "Quantity",
  unit_amount: "UnitAmount",
  unitAmount: "UnitAmount",
  account_code: "AccountCode",
  accountCode: "AccountCode",
  tax_type: "TaxType",
  taxType: "TaxType",
  item_code: "ItemCode",
  itemCode: "ItemCode",
  line_item_id: "LineItemID",
  lineItemId: "LineItemID",
  discount_rate: "DiscountRate",
  discountRate: "DiscountRate",
};

const INVOICE_UPDATE_KEYS = new Set([
  "InvoiceID",
  "Type",
  "Contact",
  "Date",
  "DueDate",
  "LineAmountTypes",
  "LineItems",
  "Reference",
  "Status",
  "CurrencyCode",
]);

const QUOTE_UPDATE_KEYS = new Set([
  "QuoteID",
  "Contact",
  "Date",
  "ExpiryDate",
  "LineAmountTypes",
  "LineItems",
  "Reference",
  "Status",
  "Title",
  "CurrencyCode",
]);

function pascalKey(key: string): string {
  if (LINE_ITEM_KEYS[key]) return LINE_ITEM_KEYS[key]!;
  if (/^[A-Z]/.test(key)) return key;
  return key;
}

export function todayXeroDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeXeroLineItems(
  items: unknown[],
  opts: { defaultTaxType?: string; requireTaxType?: boolean } = {}
): { ok: true; lineItems: Record<string, unknown>[] } | { ok: false; error: string } {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `line_items[${i}] must be an object` };
    }
    const src = raw as Record<string, unknown>;
    const line: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null) continue;
      const pk = pascalKey(k);
      if (pk === "LineAmount" || pk === "TaxAmount") continue;
      line[pk] = v;
    }
    const desc = String(line["Description"] ?? "").trim();
    if (!desc) {
      return { ok: false, error: `line_items[${i}].Description is required (min 1 char)` };
    }
    line["Description"] = desc;
    if (line["Quantity"] === undefined) line["Quantity"] = 1;
    const qty = Number(line["Quantity"]);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: `line_items[${i}].Quantity must be a positive number` };
    }
    line["Quantity"] = qty;
    if (line["UnitAmount"] !== undefined) {
      const amt = Number(line["UnitAmount"]);
      if (!Number.isFinite(amt)) {
        return { ok: false, error: `line_items[${i}].UnitAmount must be numeric` };
      }
      line["UnitAmount"] = amt;
    }
    if (!line["TaxType"] && opts.defaultTaxType) {
      line["TaxType"] = opts.defaultTaxType;
    }
    if (opts.requireTaxType && !line["TaxType"]) {
      return {
        ok: false,
        error:
          `line_items[${i}] needs TaxType (call xero_list_tax_rates; sales quotes often use OUTPUT or NONE)`,
      };
    }
    out.push(line);
  }
  return { ok: true, lineItems: out };
}

export function sanitizeInvoiceUpdate(
  invoiceId: string,
  partial: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { InvoiceID: invoiceId };
  for (const [k, v] of Object.entries(partial)) {
    if (!INVOICE_UPDATE_KEYS.has(k) || v === undefined) continue;
    if (k === "Contact" && v && typeof v === "object") {
      const c = v as Record<string, unknown>;
      const contactId = c["ContactID"] ?? c["contact_id"];
      if (typeof contactId === "string" && contactId.trim()) {
        out["Contact"] = { ContactID: contactId.trim() };
      }
      continue;
    }
    if (k === "LineItems" && Array.isArray(v)) {
      const norm = normalizeXeroLineItems(v);
      if (norm.ok) out["LineItems"] = norm.lineItems;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function sanitizeQuoteCreate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of QUOTE_UPDATE_KEYS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (!out["Date"]) out["Date"] = todayXeroDate();
  if (!out["LineAmountTypes"]) out["LineAmountTypes"] = "Exclusive";
  if (!out["Status"]) out["Status"] = "DRAFT";
  if (out["Contact"] && typeof out["Contact"] === "object") {
    const c = out["Contact"] as Record<string, unknown>;
    const contactId = c["ContactID"] ?? c["contact_id"];
    if (typeof contactId === "string") out["Contact"] = { ContactID: contactId.trim() };
  }
  return out;
}

function collectValidationMessages(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const errs = obj["ValidationErrors"];
  if (Array.isArray(errs)) {
    for (const e of errs) {
      if (e && typeof e === "object" && typeof (e as { Message?: string }).Message === "string") {
        out.push((e as { Message: string }).Message);
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const child of v) collectValidationMessages(child, out);
    }
  }
}

export function formatXeroApiError(status: number, data: unknown, text: string): string {
  const messages: string[] = [];
  collectValidationMessages(data, messages);
  const unique = [...new Set(messages)].filter(Boolean);

  let headline = "";
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d["Message"] === "string" && d["Message"].trim()) {
      headline = d["Message"].trim();
    } else if (typeof d["Detail"] === "string" && d["Detail"].trim()) {
      headline = d["Detail"].trim();
    }
  }
  if (!headline) headline = text.slice(0, 200).trim() || "request failed";

  let err = `Xero HTTP ${status}: ${headline}`;
  if (unique.length > 0) {
    err += ` — ${unique.slice(0, 6).join("; ")}`;
    if (unique.length > 6) err += ` (+${unique.length - 6} more)`;
  }
  if (status === 400) {
    err +=
      ". Tip: use PascalCase fields (Description, UnitAmount, AccountCode, TaxType); for quotes set TaxType per line; for invoice status changes use xero_set_invoice_status.";
  }
  return err;
}
