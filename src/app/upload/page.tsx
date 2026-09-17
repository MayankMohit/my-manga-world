import Link from "next/link";
import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth/require-user";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Upload",
  description:
    "Upload a comic or book to Shelf. No account needed to start; sign in when you are ready to read.",
};

const STEPS = [
  {
    title: "Add your file",
    body: "Drop in a CBZ, CBR, CB7, PDF, EPUB, or a folder of images. No account required to start.",
  },
  {
    title: "We get it ready",
    body: "Shelf extracts and optimizes the pages in the background while you wait.",
  },
  {
    title: "Sign in to read",
    body: "Create an account or sign in when you want to read. Everything you uploaded is saved to it.",
  },
];

/**
 * Public upload entry point. Uploading needs no account (claim-on-auth, D26).
 * The full drag-and-drop uploader and its API land in Phase 3; until then this
 * page explains the flow and routes visitors to sign in or create an account.
 */
export default async function UploadPage() {
  const ctx = await getAuthContext();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Shelf home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {ctx ? (
            <Link
              href="/library"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Library
            </Link>
          ) : (
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
        <section className="flex flex-col items-start gap-4 py-14 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Upload a file
          </h1>
          <p className="text-muted max-w-xl text-lg">
            You can upload without an account and sign in only when you are ready to read.
            The drag-and-drop uploader is on its way in the next update.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {ctx ? (
              <Link href="/library" className={buttonVariants({ size: "lg" })}>
                Open your library
              </Link>
            ) : (
              <>
                <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                  Create an account
                </Link>
                <Link
                  href="/login"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="border-border bg-surface rounded-2xl border p-6"
            >
              <div className="text-accent text-sm font-semibold">Step {i + 1}</div>
              <h2 className="mt-1 font-medium">{s.title}</h2>
              <p className="text-muted mt-2 text-sm">{s.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
