"use client";

import { useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const WATCHED_TABLES = [
  // Production tables
  "blocks",
  "slab_requirements",
  "cut_sessions",
  "cut_session_blocks",
  "cut_session_slabs",
  "carving_items",
  "dispatch_logs",
  "notifications",
  // Mig 052 follow-on (Daksh, May 2026): finance pages weren't
  // auto-refreshing when the owner confirmed a payment on his PC —
  // the accountant's screen stayed stale until manual reload. Same
  // for vendor edits, new bills, bank-reject flips. Adding the
  // three core accounting tables to the watch list — every page in
  // /accounts/* re-fetches on the next event within ~450ms.
  "bills",
  "bill_payments",
  "bill_vendors",
] as const;

export function RealtimeRefresh() {
  const router = useRouter();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase.channel("mtcpl-live-refresh");

    WATCHED_TABLES.forEach((table) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table
        },
        () => {
          if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
          }

          timeoutRef.current = window.setTimeout(() => {
            startTransition(() => {
              router.refresh();
            });
          }, 450);
        }
      );
    });

    channel.subscribe();

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }

      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
