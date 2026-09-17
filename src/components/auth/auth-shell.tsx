import * as React from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Centered card layout shared by the login and signup pages. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Shelf home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="border-border bg-surface rounded-2xl border p-6 sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="text-muted mt-6 text-center text-sm">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
