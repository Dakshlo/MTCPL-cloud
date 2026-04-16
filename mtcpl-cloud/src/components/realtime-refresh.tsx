"use client";

import { useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const WATCHED_TABLES = [
  "blocks",
  "slab_requirements",
  "cut_sessions",
  "cut_session_blocks",
  "cut_session_slabs",
  "carving_items",
  "dispatch_logs",
  "notifications"
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
