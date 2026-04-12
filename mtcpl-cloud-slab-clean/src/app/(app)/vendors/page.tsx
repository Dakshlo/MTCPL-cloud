import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";

export default async function VendorsPage() {
  await requireAuth(["owner"]);
  redirect("/settings?section=vendors");
}
