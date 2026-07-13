import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";

export default async function UsersPage() {
  await requireAuth(["owner"]);
  redirect("/settings?section=users");
}
