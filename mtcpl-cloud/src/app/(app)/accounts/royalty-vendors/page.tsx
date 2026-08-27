import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { RoyaltyVendorsClient } from "./royalty-vendors-client";

/**
 * /accounts/royalty-vendors — the owner's royalty browser.
 *
 * Reached from a button on the Royalty Summary. Owner / developer
 * only; the passphrase gate lives in the client (and is re-verified
 * inside every action it calls, so this page is not the only lock).
 */
export const dynamic = "force-dynamic";

export default async function RoyaltyVendorsPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect("/accounts");
  }
  return <RoyaltyVendorsClient isDeveloper={profile.role === "developer"} />;
}
