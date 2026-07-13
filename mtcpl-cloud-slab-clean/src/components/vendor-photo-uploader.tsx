"use client";

import { startTransition, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function VendorPhotoUploader({ slabId }: { slabId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;

    const supabase = createBrowserSupabaseClient();
    setPending(true);
    setMessage("");

    try {
      for (const file of Array.from(files)) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "-");
        const filePath = `${slabId}/${Date.now()}-${cleanName}`;

        const { error: uploadError } = await supabase.storage.from("vendor-completion").upload(filePath, file, {
          cacheControl: "3600",
          upsert: false
        });

        if (uploadError) throw uploadError;

        const { data: publicUrl } = supabase.storage.from("vendor-completion").getPublicUrl(filePath);
        const { error: insertError } = await supabase.from("vendor_completion_photos").insert({
          slab_id: slabId,
          file_path: filePath,
          file_url: publicUrl.publicUrl
        });

        if (insertError) throw insertError;
      }

      setMessage("Images uploaded successfully.");
      if (inputRef.current) inputRef.current.value = "";
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <input multiple accept="image/*" onChange={handleUpload} ref={inputRef} type="file" />
      {pending ? <span className="muted">Uploading images...</span> : null}
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}
