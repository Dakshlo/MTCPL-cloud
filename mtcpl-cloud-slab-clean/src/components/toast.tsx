"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function ToastInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const msg = searchParams.get("toast");
    if (!msg) return;

    setMessage(decodeURIComponent(msg));
    setVisible(true);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("toast");
    router.replace(pathname + (params.toString() ? `?${params}` : ""), { scroll: false });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 3000);
  }, [searchParams, pathname, router]);

  if (!message) return null;

  return (
    <div className={`toast-notification ${visible ? "toast-visible" : "toast-hidden"}`}>
      <span className="toast-icon">✓</span>
      {message}
    </div>
  );
}

export function Toast() {
  return (
    <Suspense fallback={null}>
      <ToastInner />
    </Suspense>
  );
}
