"use client";

// Tiny humanized elapsed-time label — "45 min", "6 h", "3 d 4 h", "2 mo".
// Client component so the server page doesn't bake in a stale "now" at
// build/render time. Used on dispatch slab cards (ready-since timer) and
// the Rework Tunnel (held-since).

export function timeAgoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 31) {
    const remH = hrs % 24;
    return remH > 0 && days < 7 ? `${days} d ${remH} h` : `${days} d`;
  }
  const months = Math.floor(days / 30);
  return `${months} mo`;
}

export function TimeAgo({ iso }: { iso: string }) {
  return <>{timeAgoLabel(iso)}</>;
}
