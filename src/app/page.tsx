import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/require-user";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallButton } from "@/components/pwa/install-button";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    title: "Your archives, your rules",
    body: "Upload CBZ, CBR, CB7, PDF, EPUB, or image folders. Everything stays in your own storage.",
  },
  {
    title: "A reader that gets out of the way",
    body: "Webtoon, single, and double-page modes, RTL or LTR, with fit and zoom controls tuned for long reading.",
  },
  {
    title: "Progress that follows you",
    body: "Pick up exactly where you left off on any device. Your place is saved automatically.",
  },
  {
    title: "Private by design",
    body: "No public library and no discovery. Share a series only with the people you invite.",
  },
];

export default async function Home() {
  const ctx = await getAuthContext();
  if (ctx) redirect("/library");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <InstallButton />
          <ThemeToggle />
          <Link
            href="/login"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
        <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Upload a comic and start reading. No account needed to begin.
          </h1>
          <p className="text-muted max-w-xl text-lg">
            Shelf is a private reader for archives you already own. Drop in a file and we
            get it ready. Create an account only when you are ready to read, and
            everything you uploaded is saved to it.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/upload" className={buttonVariants({ size: "lg" })}>
              Upload a file
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border-border bg-surface rounded-2xl border p-6"
            >
              <h2 className="font-medium">{f.title}</h2>
              <p className="text-muted mt-2 text-sm">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-border mx-auto w-full max-w-5xl border-t px-6 py-6">
        <p className="text-muted text-sm">
          Shelf. A private reader for your own library.
        </p>
      </footer>
    </div>
  );
}
