"use client";

import { useEffect } from "react";

export function Heartbeat() {
  useEffect(() => {
    // Send once on mount, then every 2 minutes
    function ping() { fetch("/api/heartbeat", { method: "POST" }).catch(() => {}); }
    ping();
    const id = setInterval(ping, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
