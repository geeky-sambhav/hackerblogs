"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Publisher preview image, hotlinked (never copied or proxied); hides itself if it fails. */
export function Thumb({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("bg-muted object-cover", className)}
    />
  );
}
