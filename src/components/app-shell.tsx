import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/app" className="text-lg font-semibold">
            DeFi Risk Manager
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/app">Dashboard</Link>
            <Link href="/app/settings">Settings</Link>
            <ThemeToggle />
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
