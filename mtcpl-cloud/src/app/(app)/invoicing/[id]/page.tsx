// Mig 058 — /invoicing/[id] moved to /invoicing/invoices/[id].
// Keep the old URL alive as a 308 redirect so any bookmark /
// external link still resolves.

import { redirect } from "next/navigation";

type Params = Promise<{ id: string }>;

export default async function LegacyInvoiceDetailRedirect({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  redirect(`/invoicing/invoices/${id}`);
}
