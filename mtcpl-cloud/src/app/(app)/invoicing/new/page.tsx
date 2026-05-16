// Mig 058 — /invoicing/new moved to /invoicing/invoices/new. Keep
// the old URL alive as a 308 redirect so any bookmark / topbar
// shortcut / external link still resolves.

import { redirect } from "next/navigation";

export default function LegacyNewInvoiceRedirect() {
  redirect("/invoicing/invoices/new");
}
