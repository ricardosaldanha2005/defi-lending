"use client";

import { usePathname, useRouter } from "next/navigation";

type Props = {
  className?: string;
};

export function ViewModeToggle({ className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isSimple = pathname?.startsWith("/mobile");

  const setMode = (mode: "simple" | "pro") => {
    document.cookie = `view_mode=${mode}; path=/; max-age=31536000`;
    router.push(mode === "simple" ? "/mobile" : "/app");
  };

  return (
    <div
      className={`inline-flex items-center rounded-full border bg-background/80 p-0.5 text-xs ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setMode("simple")}
        className={`rounded-full px-2 py-1 transition ${
          isSimple
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Simples
      </button>
      <button
        type="button"
        onClick={() => setMode("pro")}
        className={`rounded-full px-2 py-1 transition ${
          !isSimple
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Pro
      </button>
    </div>
  );
}
