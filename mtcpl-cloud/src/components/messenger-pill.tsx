"use client";

// ──────────────────────────────────────────────────────────────────
// Messenger pill + floating phone-shaped panel (Mig 078)
// ──────────────────────────────────────────────────────────────────
// Daksh May 2026 pilot — WhatsApp-shaped 1:1 chat baked into the
// MTCPL topbar. Round-2 follow-on: widened from a strict owner ↔
// developer pair to a contacts roster (every owner + developer can
// chat with every other one). The panel now has TWO views:
//
//   • Contacts list — opens by default. Each row: avatar, name,
//     role pill, last message snippet (with "You:" prefix if the
//     last one was from us), time, unread badge.
//   • Thread view — opened by clicking a contact. Shows the
//     conversation with that peer. ← back arrow at top-left
//     returns to the contacts list.
//
// State machine: { view: "contacts" | "thread", activePeerId }.
// The realtime subscription refetches the relevant view's data on
// every messenger_messages change.
//
// Visual / layout (unchanged from round-1):
//   • Pill mirrors TopbarTasksBadge / NotificationBell shape.
//   • Panel is position: fixed, bottom-right on desktop, full-
//     screen sheet on mobile. Phone-shaped via radius + size.
//
// Voice notes: MediaRecorder hold-to-record, drag-up to cancel.
// ──────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  getMessengerUnreadCount,
  getSignedMediaUrl,
  loadMessengerContacts,
  loadMessengerThread,
  markThreadReadAction,
  sendMediaMessage,
  sendTextMessage,
  softDeleteMessage,
  type MessengerContact,
  type MessengerMessage,
} from "@/app/(app)/messenger/actions";

type MessengerProfile = {
  id: string;
  role: "owner" | "developer";
  full_name: string | null;
};

// ── Date helpers ──────────────────────────────────────────────────

function dateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dividerLabel(key: string): string {
  const todayKey = dateKey(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = dateKey(y.toISOString());
  if (key === todayKey) return "Today";
  if (key === yKey) return "Yesterday";
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Compact "now-ish" label for contact rows: 10:32, Yesterday, 23 May. */
function contactsTimeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const todayKey = dateKey(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = dateKey(y.toISOString());
  const k = dateKey(iso);
  if (k === todayKey) {
    return d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (k === yKey) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function avatarLetter(name: string | null | undefined): string {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "•";
}

function roleLabel(role: "owner" | "developer"): string {
  return role === "owner" ? "Owner" : "Developer";
}

// ── Pill ──────────────────────────────────────────────────────────

export function MessengerPill({ profile }: { profile: MessengerProfile }) {
  const [open, setOpen] = useState(false);
  const [badge, setBadge] = useState(0);

  // Initial unread count for the badge — cheap query, fire on mount.
  useEffect(() => {
    let cancelled = false;
    getMessengerUnreadCount().then((c) => {
      if (!cancelled) setBadge(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc closes the panel from anywhere.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={badge > 0 ? `${badge} unread` : "Messenger"}
        aria-expanded={open}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          background: badge > 0 ? "var(--gold)" : "var(--bg)",
          color: badge > 0 ? "#fff" : "var(--text)",
          border: `1px solid ${badge > 0 ? "var(--gold-dark)" : "var(--border)"}`,
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 13,
          lineHeight: 1,
          whiteSpace: "nowrap",
          fontWeight: 700,
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>💬</span>
        {badge > 0 && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              padding: "1px 7px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.28)",
              color: "#fff",
              minWidth: 18,
              textAlign: "center",
            }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {badge > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#dc2626",
              border: "1.5px solid var(--surface, #fff)",
            }}
          />
        )}
      </button>

      {open && (
        <MessengerPanel
          self={profile}
          onClose={() => setOpen(false)}
          setBadge={setBadge}
        />
      )}
    </>
  );
}

// ── Panel (state machine: contacts ↔ thread) ──────────────────────

function MessengerPanel({
  self,
  onClose,
  setBadge,
}: {
  self: MessengerProfile;
  onClose: () => void;
  setBadge: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [view, setView] = useState<"contacts" | "thread">("contacts");
  const [contacts, setContacts] = useState<MessengerContact[]>([]);
  const [activePeer, setActivePeer] = useState<MessengerContact | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refreshContacts = useCallback(async () => {
    const res = await loadMessengerContacts();
    if (!res.ok) {
      setLoadingContacts(false);
      return;
    }
    setContacts(res.contacts);
    setLoadingContacts(false);
    const total = res.contacts.reduce((s, c) => s + c.unread_count, 0);
    setBadge(total);
  }, [setBadge]);

  const refreshThread = useCallback(async (peerId: string) => {
    const res = await loadMessengerThread(peerId);
    if (!res.ok) return;
    setActivePeer(res.peer);
    setMessages(res.messages);
  }, []);

  // Hydrate contacts on mount.
  useEffect(() => {
    void refreshContacts();
  }, [refreshContacts]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Track the active peer ID in a ref so the realtime callback
  // always reads the latest value without resubscribing every time
  // we change view/active peer (which would tear down + reset the
  // channel on every navigation).
  const activePeerIdRef = useRef<string | null>(null);
  activePeerIdRef.current = activePeer?.id ?? null;
  const viewRef = useRef(view);
  viewRef.current = view;

  // Realtime — one channel for the panel's lifetime.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let debounce: number | null = null;

    const channel = supabase
      .channel("messenger-pilot")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messenger_messages" },
        () => {
          if (debounce !== null) window.clearTimeout(debounce);
          debounce = window.setTimeout(() => {
            startTransition(() => {
              void refreshContacts();
              const peerId = activePeerIdRef.current;
              if (viewRef.current === "thread" && peerId) {
                void refreshThread(peerId);
              }
            });
          }, 200);
        },
      )
      .subscribe();

    return () => {
      if (debounce !== null) window.clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [refreshContacts, refreshThread]);

  // Open a thread: load it + stamp read_at + optimistically zero the
  // peer's unread count locally so the badge updates instantly.
  const openThread = useCallback(
    async (peer: MessengerContact) => {
      setActivePeer(peer);
      setView("thread");
      setMessages([]); // brief loading state
      await refreshThread(peer.id);
      const fd = new FormData();
      fd.set("peer_id", peer.id);
      void markThreadReadAction(fd).then(() => {
        setContacts((prev) =>
          prev.map((c) =>
            c.id === peer.id ? { ...c, unread_count: 0 } : c,
          ),
        );
        setBadge((b) => Math.max(0, b - peer.unread_count));
      });
    },
    [refreshThread, setBadge],
  );

  const backToContacts = useCallback(() => {
    setView("contacts");
    setActivePeer(null);
    setMessages([]);
    void refreshContacts();
  }, [refreshContacts]);

  // ── Sending ─────────────────────────────────────────────────────

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);

  const sendText = useCallback(async () => {
    if (!activePeer) return;
    const body = draft.trim();
    if (!body) return;
    setIsSending(true);
    const fd = new FormData();
    fd.set("recipient_id", activePeer.id);
    fd.set("body", body);
    const res = await sendTextMessage(fd);
    setIsSending(false);
    if (!res.ok) {
      setToast(res.error);
      return;
    }
    setDraft("");
    // Optimistic append — realtime + refresh will reconcile shortly.
    // Skip if a refetch already landed this row (race-safe).
    setMessages((prev) => {
      if (res.id && prev.some((m) => m.id === res.id)) return prev;
      return [
        ...prev,
        {
          id: res.id ?? `local-${Date.now()}`,
          sender_id: self.id,
          recipient_id: activePeer.id,
          kind: "text",
          body,
          media_path: null,
          media_mime: null,
          media_duration_sec: null,
          read_at: null,
          deleted_at: null,
          deleted_by: null,
          created_at: new Date().toISOString(),
        },
      ];
    });
  }, [activePeer, draft, self.id]);

  const sendMedia = useCallback(
    async (file: File, kind: "voice" | "image", durationSec?: number) => {
      if (!activePeer) return;
      setIsSending(true);
      const fd = new FormData();
      fd.set("recipient_id", activePeer.id);
      fd.set("file", file);
      fd.set("kind", kind);
      if (durationSec !== undefined) {
        fd.set("duration_sec", String(durationSec));
      }
      const res = await sendMediaMessage(fd);
      setIsSending(false);
      if (!res.ok) {
        setToast(res.error);
      }
    },
    [activePeer],
  );

  const handleDelete = useCallback(async (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    const res = await softDeleteMessage(fd);
    if (!res.ok) {
      setToast(res.error);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              body: null,
              media_path: null,
              deleted_at: new Date().toISOString(),
              deleted_by: self.id,
            }
          : m,
      ),
    );
  }, [self.id]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.18)",
          zIndex: 1500,
        }}
      />
      <div
        role="dialog"
        aria-label="Messenger"
        onClick={(e) => e.stopPropagation()}
        className="messenger-panel"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          width: 360,
          height: 640,
          maxHeight: "calc(100vh - 36px)",
          background: "var(--surface, #fff)",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: 28,
          boxShadow:
            "0 24px 64px rgba(15,23,42,0.28), 0 0 0 1px rgba(15,23,42,0.04)",
          zIndex: 1600,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <style>{`
          @media (max-width: 640px) {
            .messenger-panel {
              left: 0 !important;
              right: 0 !important;
              bottom: 0 !important;
              top: 0 !important;
              width: 100vw !important;
              height: 100dvh !important;
              max-height: none !important;
              border-radius: 0 !important;
              border: none !important;
            }
          }
          @keyframes mtcpl-mic-pulse {
            0%   { box-shadow: 0 0 0 0 rgba(220,38,38,0.55); }
            70%  { box-shadow: 0 0 0 14px rgba(220,38,38,0.0); }
            100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.0); }
          }
        `}</style>

        {view === "contacts" ? (
          <ContactsView
            self={self}
            contacts={contacts}
            loading={loadingContacts}
            onOpen={openThread}
            onClose={onClose}
          />
        ) : (
          <ThreadView
            self={self}
            peer={activePeer}
            messages={messages}
            draft={draft}
            setDraft={setDraft}
            isSending={isSending}
            onSendText={sendText}
            onSendMedia={sendMedia}
            onDelete={handleDelete}
            onBack={backToContacts}
            onClose={onClose}
            onError={(m) => setToast(m)}
            onImagePreview={(url) => setLightboxUrl(url)}
          />
        )}

        {toast && (
          <div
            style={{
              position: "absolute",
              bottom: 78,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(15,23,42,0.92)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: 999,
              maxWidth: "85%",
              textAlign: "center",
              zIndex: 5,
            }}
          >
            {toast}
          </div>
        )}
      </div>

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 1700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Attachment"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            }}
          />
        </div>
      )}
    </>
  );
}

// ── Contacts list view ────────────────────────────────────────────

function ContactsView({
  self,
  contacts,
  loading,
  onOpen,
  onClose,
}: {
  self: MessengerProfile;
  contacts: MessengerContact[];
  loading: boolean;
  onOpen: (peer: MessengerContact) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          background: "var(--gold, #c9a14a)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>
            Messages
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.85, lineHeight: 1.2 }}>
            Signed in as {self.full_name || roleLabel(self.role)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close messenger"
          style={{
            background: "rgba(255,255,255,0.18)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--bg, #faf7f0)",
        }}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Loading…
          </div>
        ) : contacts.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            No one to chat with yet.
            <br />
            Ask Daksh to add another owner or developer profile.
          </div>
        ) : (
          contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(15,23,42,0.06)",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--text)",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(201,161,74,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background:
                    c.role === "developer"
                      ? "linear-gradient(135deg, #d4ad58, #c9a14a)"
                      : "linear-gradient(135deg, #1a1a1a, #404040)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 17,
                  fontWeight: 800,
                  flexShrink: 0,
                  boxShadow: "0 1px 2px rgba(15,23,42,0.12)",
                }}
              >
                {avatarLetter(c.full_name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 700,
                    lineHeight: 1.25,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {c.full_name || roleLabel(c.role)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 7px",
                      borderRadius: 999,
                      background:
                        c.role === "developer"
                          ? "rgba(201,161,74,0.18)"
                          : "rgba(15,23,42,0.08)",
                      color:
                        c.role === "developer"
                          ? "var(--gold-dark, #a88534)"
                          : "rgba(15,23,42,0.65)",
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                      flexShrink: 0,
                    }}
                  >
                    {roleLabel(c.role)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color:
                      c.unread_count > 0
                        ? "var(--text)"
                        : "rgba(15,23,42,0.55)",
                    fontWeight: c.unread_count > 0 ? 600 : 400,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.last_message_snippet
                    ? (c.last_message_from_self ? "You: " : "") +
                      c.last_message_snippet
                    : "Tap to start a conversation"}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    color: "rgba(15,23,42,0.45)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {contactsTimeLabel(c.last_message_at)}
                </span>
                {c.unread_count > 0 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: "1px 7px",
                      borderRadius: 999,
                      background: "var(--gold)",
                      color: "#fff",
                      minWidth: 18,
                      textAlign: "center",
                    }}
                  >
                    {c.unread_count > 99 ? "99+" : c.unread_count}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}

// ── Thread view ───────────────────────────────────────────────────

function ThreadView({
  self,
  peer,
  messages,
  draft,
  setDraft,
  isSending,
  onSendText,
  onSendMedia,
  onDelete,
  onBack,
  onClose,
  onError,
  onImagePreview,
}: {
  self: MessengerProfile;
  peer: MessengerContact | null;
  messages: MessengerMessage[];
  draft: string;
  setDraft: (s: string) => void;
  isSending: boolean;
  onSendText: () => Promise<void> | void;
  onSendMedia: (
    file: File,
    kind: "voice" | "image",
    durationSec?: number,
  ) => Promise<void> | void;
  onDelete: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
  onImagePreview: (url: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const grouped = useMemo(() => {
    const groups: Array<{ key: string; items: MessengerMessage[] }> = [];
    for (const m of messages) {
      const k = dateKey(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.items.push(m);
      else groups.push({ key: k, items: [m] });
    }
    return groups;
  }, [messages]);

  const peerName = peer?.full_name?.trim() || (peer ? roleLabel(peer.role) : "—");

  return (
    <>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "var(--gold, #c9a14a)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to contacts"
          style={{
            background: "rgba(255,255,255,0.18)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 30,
            height: 30,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background:
              peer?.role === "developer"
                ? "linear-gradient(135deg, #d4ad58, #c9a14a)"
                : "rgba(255,255,255,0.22)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 800,
            flexShrink: 0,
            boxShadow: peer?.role === "developer" ? "0 1px 2px rgba(15,23,42,0.18)" : undefined,
          }}
        >
          {avatarLetter(peer?.full_name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {peerName}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.85, lineHeight: 1.2 }}>
            {peer ? roleLabel(peer.role) : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close messenger"
          style={{
            background: "rgba(255,255,255,0.18)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 12px",
          background:
            "linear-gradient(180deg, rgba(201,161,74,0.04), rgba(201,161,74,0.0) 220px), var(--bg, #faf7f0)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {messages.length === 0 && peer && (
          <div
            style={{
              textAlign: "center",
              padding: 18,
              fontSize: 13,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            No messages yet. Say hi 👋
          </div>
        )}

        {grouped.map((g) => (
          <div key={g.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                margin: "10px 0 6px",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "2px 10px",
                  borderRadius: 999,
                  background: "rgba(15,23,42,0.06)",
                  color: "rgba(15,23,42,0.55)",
                  letterSpacing: "0.04em",
                }}
              >
                {dividerLabel(g.key)}
              </span>
            </div>
            {g.items.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                isOwn={m.sender_id === self.id}
                onDelete={() => onDelete(m.id)}
                onImagePreview={onImagePreview}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Composer */}
      <Composer
        draft={draft}
        setDraft={setDraft}
        textRef={textRef}
        fileInputRef={fileInputRef}
        onSendText={onSendText}
        onSendMedia={onSendMedia}
        onError={onError}
        disabled={!peer || isSending}
      />
    </>
  );
}

// ── Bubble ────────────────────────────────────────────────────────

function Bubble({
  message,
  isOwn,
  onDelete,
  onImagePreview,
}: {
  message: MessengerMessage;
  isOwn: boolean;
  onDelete: () => void;
  onImagePreview: (url: string) => void;
}) {
  const isDeleted = !!message.deleted_at;
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const startPress = () => {
    if (!isOwn || isDeleted) return;
    pressTimer.current = window.setTimeout(() => setMenuOpen(true), 500);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isOwn ? "flex-end" : "flex-start",
        margin: "3px 0",
        position: "relative",
      }}
    >
      <div
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onContextMenu={(e) => {
          if (!isOwn || isDeleted) return;
          e.preventDefault();
          setMenuOpen(true);
        }}
        style={{
          maxWidth: "78%",
          padding: "8px 12px",
          borderRadius: 18,
          borderBottomRightRadius: isOwn ? 6 : 18,
          borderBottomLeftRadius: isOwn ? 18 : 6,
          background: isOwn
            ? "linear-gradient(135deg, #d4ad58 0%, #c9a14a 100%)"
            : "var(--surface, #fff)",
          color: isOwn ? "#fff" : "var(--text, #111)",
          fontSize: 13.5,
          lineHeight: 1.4,
          boxShadow: isOwn
            ? "0 1px 2px rgba(184,115,51,0.18)"
            : "0 1px 2px rgba(15,23,42,0.08)",
          border: isOwn ? "none" : "1px solid rgba(15,23,42,0.06)",
          position: "relative",
          wordBreak: "break-word",
        }}
      >
        {isDeleted ? (
          <span
            style={{
              fontStyle: "italic",
              opacity: 0.68,
              fontSize: 12.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            🚫 This message was deleted
          </span>
        ) : message.kind === "text" ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{message.body}</span>
        ) : message.kind === "voice" ? (
          <VoiceBubble message={message} isOwn={isOwn} />
        ) : (
          <ImageBubble message={message} onPreview={onImagePreview} />
        )}
        <div
          style={{
            fontSize: 9.5,
            opacity: isOwn ? 0.78 : 0.55,
            marginTop: 3,
            textAlign: "right",
            color: isOwn ? "rgba(255,255,255,0.86)" : undefined,
          }}
        >
          {timeLabel(message.created_at)}
          {isOwn && !isDeleted && message.read_at
            ? " · ✓✓"
            : isOwn && !isDeleted
              ? " · ✓"
              : ""}
        </div>

        {menuOpen && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 10 }}
            />
            <div
              style={{
                position: "absolute",
                top: -34,
                right: 0,
                background: "var(--surface, #fff)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 2,
                boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
                zIndex: 20,
                display: "flex",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#dc2626",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 12px",
                  cursor: "pointer",
                  borderRadius: 6,
                }}
              >
                🗑 Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Voice / image lazy-render ─────────────────────────────────────

function VoiceBubble({
  message,
  isOwn,
}: {
  message: MessengerMessage;
  isOwn: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!message.media_path) return;
    let cancelled = false;
    getSignedMediaUrl(message.media_path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [message.media_path]);

  if (!url) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden>🎙</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Loading voice…</span>
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
      <span aria-hidden style={{ fontSize: 15 }}>🎙</span>
      <audio
        controls
        src={url}
        style={{
          width: 200,
          height: 32,
          filter: isOwn ? "invert(1) hue-rotate(180deg)" : undefined,
        }}
      />
      {message.media_duration_sec !== null && (
        <span
          style={{
            fontSize: 11,
            opacity: 0.75,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(message.media_duration_sec)}
        </span>
      )}
    </div>
  );
}

function ImageBubble({
  message,
  onPreview,
}: {
  message: MessengerMessage;
  onPreview: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!message.media_path) return;
    let cancelled = false;
    getSignedMediaUrl(message.media_path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [message.media_path]);

  if (!url) {
    return (
      <span
        style={{
          fontSize: 12,
          opacity: 0.7,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span aria-hidden>🖼</span>
        <span>Loading image…</span>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Attachment"
      onClick={() => onPreview(url)}
      style={{
        maxWidth: 220,
        maxHeight: 260,
        borderRadius: 12,
        cursor: "zoom-in",
        display: "block",
      }}
    />
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Composer (text + paperclip + hold-to-record) ──────────────────

function Composer({
  draft,
  setDraft,
  textRef,
  fileInputRef,
  onSendText,
  onSendMedia,
  onError,
  disabled,
}: {
  draft: string;
  setDraft: (s: string) => void;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSendText: () => Promise<void> | void;
  onSendMedia: (
    file: File,
    kind: "voice" | "image",
    durationSec?: number,
  ) => Promise<void> | void;
  onError: (msg: string) => void;
  disabled: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef<number>(0);
  const recTimerRef = useRef<number | null>(null);
  const recOriginYRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [micDisabled, setMicDisabled] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft, textRef]);

  function stopRecorder(commit: boolean) {
    cancelledRef.current = !commit;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  }

  function teardownRecording() {
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setCancelArmed(false);
    setElapsed(0);
  }

  async function startRecording(originY: number) {
    if (disabled || micDisabled) return;
    if (recording) return;
    recOriginYRef.current = originY;
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const cancelled = cancelledRef.current;
        const dur = Math.round((Date.now() - recStartRef.current) / 1000);
        const chunks = chunksRef.current.slice();
        teardownRecording();
        if (cancelled || chunks.length === 0) return;
        if (dur < 1) {
          onError("Voice note too short");
          return;
        }
        const type = chunks[0]?.type || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        await onSendMedia(file, "voice", dur);
      };
      rec.start();
      recStartRef.current = Date.now();
      setRecording(true);
      recTimerRef.current = window.setInterval(() => {
        const e = Math.round((Date.now() - recStartRef.current) / 1000);
        setElapsed(e);
        if (e >= 120) stopRecorder(true);
      }, 200);
    } catch (err) {
      teardownRecording();
      setMicDisabled(true);
      onError(
        err instanceof Error && err.message
          ? `Microphone: ${err.message}`
          : "Microphone access denied",
      );
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!recording) return;
    const dy = recOriginYRef.current - e.clientY;
    setCancelArmed(dy > 60);
  }

  function handlePointerUp() {
    if (!recording) return;
    stopRecorder(!cancelArmed);
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    void onSendMedia(f, "image");
  }

  const canSendText = draft.trim().length > 0 && !disabled;

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border)",
        padding: "8px 10px",
        background: "var(--surface, #fff)",
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        position: "relative",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleFilePicked}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach image"
        style={{
          background: "transparent",
          border: "none",
          fontSize: 20,
          lineHeight: 1,
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 4,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📎
      </button>

      <textarea
        ref={textRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void onSendText();
          }
        }}
        placeholder={recording ? "Recording…" : "Type a message"}
        rows={1}
        disabled={disabled || recording}
        style={{
          flex: 1,
          resize: "none",
          border: "1px solid var(--border)",
          borderRadius: 18,
          padding: "8px 12px",
          fontSize: 13.5,
          fontFamily: "inherit",
          background: recording ? "rgba(220,38,38,0.06)" : "var(--bg, #faf7f0)",
          color: "var(--text)",
          outline: "none",
          maxHeight: 120,
          minHeight: 36,
          lineHeight: 1.4,
        }}
      />

      {canSendText ? (
        <button
          type="button"
          onClick={() => void onSendText()}
          disabled={!canSendText}
          aria-label="Send"
          style={{
            background: "var(--gold)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 38,
            height: 38,
            cursor: "pointer",
            fontSize: 17,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 1px 3px rgba(184,115,51,0.35)",
          }}
        >
          ➤
        </button>
      ) : (
        <button
          type="button"
          aria-label="Hold to record voice"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            void startRecording(e.clientY);
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            cancelledRef.current = true;
            handlePointerUp();
          }}
          disabled={disabled || micDisabled}
          style={{
            background: recording ? "#dc2626" : "var(--gold)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 38,
            height: 38,
            cursor: micDisabled ? "not-allowed" : "pointer",
            fontSize: 17,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity: micDisabled ? 0.45 : 1,
            animation: recording ? "mtcpl-mic-pulse 1.4s infinite" : undefined,
            transform: recording ? "scale(1.08)" : "scale(1)",
            transition: "transform 0.18s ease",
            touchAction: "none",
          }}
        >
          🎙
        </button>
      )}

      {recording && (
        <div
          style={{
            position: "absolute",
            top: -36,
            right: 12,
            background: cancelArmed
              ? "rgba(220,38,38,0.95)"
              : "rgba(15,23,42,0.92)",
            color: "#fff",
            fontSize: 11.5,
            fontWeight: 700,
            padding: "5px 12px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#fff",
              animation: "mtcpl-mic-pulse 1.2s infinite",
            }}
          />
          {cancelArmed
            ? "Release to cancel"
            : `${formatDuration(elapsed)} · slide up to cancel`}
        </div>
      )}
    </div>
  );
}

function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}
