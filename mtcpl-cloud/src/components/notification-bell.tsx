"use client";

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getNotifications,
  markAllReadAction,
  markOneReadAction,
  type NotificationItem,
} from "@/app/(app)/notifications/actions";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const TYPE_ICONS: Record<string, string> = {
  cut_done: "✅",
  cut_started: "✂️",
  block_rejected: "❌",
  cut_overdue: "⚠️",
  slab_deleted: "🗑️",
  block_deleted: "🗑️",
  priority_pushed: "⚡",
  blocks_added: "🧱",
};

function entityLink(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  if (entityType === "cut_session_block") return `/cutting/${entityId}`;
  if (entityType === "slab") return "/slabs";
  if (entityType === "block") return "/blocks";
  return null;
}

export function NotificationBell({ userId, role }: { userId: string; role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const { notifications, unreadCount } = await getNotifications(userId, role);
      setItems(notifications);
      setUnread(unreadCount);
    } catch {
      // silent
    }
  }, [userId, role]);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Re-fetch every 30 seconds (lightweight poll to catch realtime-refresh changes)
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        bellRef.current &&
        !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllReadAction();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    });
  }

  function handleClick(n: NotificationItem) {
    if (!n.synthetic && !n.is_read) {
      startTransition(async () => {
        await markOneReadAction(n.id);
      });
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
      setUnread((c) => Math.max(0, c - 1));
    }
    const link = entityLink(n.entity_type, n.entity_id);
    if (link) {
      setOpen(false);
      router.push(link);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        ref={bellRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) fetchNotifications();
        }}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          padding: "4px 8px",
          color: "var(--muted)",
          lineHeight: 1,
        }}
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 2,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: "#DC2626",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              lineHeight: 1,
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 380,
            maxHeight: 480,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            zIndex: 1000,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              position: "sticky",
              top: 0,
              background: "var(--surface)",
              zIndex: 1,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
              🔔 Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--gold-dark)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Items */}
          {items.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--muted-light)",
                fontSize: 13,
              }}
            >
              No notifications yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {items.map((n) => {
                const link = entityLink(n.entity_type, n.entity_id);
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    style={{
                      padding: "10px 16px",
                      borderBottom: "1px solid var(--border-light, rgba(0,0,0,0.06))",
                      cursor: link ? "pointer" : "default",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      borderLeft: n.is_read
                        ? "3px solid transparent"
                        : n.type === "cut_overdue"
                        ? "3px solid #DC2626"
                        : "3px solid var(--gold)",
                      opacity: n.is_read ? 0.55 : 1,
                      transition: "opacity 0.15s, background 0.1s",
                      background: n.is_read ? "transparent" : "rgba(184,115,51,0.04)",
                    }}
                    onMouseEnter={(e) => {
                      if (link) (e.currentTarget.style.background = "var(--surface-alt)");
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = n.is_read
                        ? "transparent"
                        : "rgba(184,115,51,0.04)";
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                      {TYPE_ICONS[n.type] ?? "📌"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: n.is_read ? 500 : 700,
                          color: n.type === "cut_overdue" ? "#DC2626" : "var(--text)",
                          lineHeight: 1.3,
                        }}
                      >
                        {n.title}
                      </div>
                      {(n.message || n.actor_name) && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 2,
                            lineHeight: 1.3,
                          }}
                        >
                          {n.message}
                          {n.actor_name && (
                            <>
                              {n.message ? " · " : ""}
                              <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                                by {n.actor_name}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 3 }}>
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                    {link && (
                      <span style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                        →
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
