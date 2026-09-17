"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH, VERIFICATION_CODE_LENGTH } from "@/lib/shared/constants";

type ErrorBody = { error?: { message?: string } } | null;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ErrorBody;
  return body?.error?.message ?? fallback;
}

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/library";

  const [step, setStep] = React.useState<"details" | "verify">("details");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError(await readError(res, "Could not start signup."));
        return;
      }
      setNotice(`We sent a ${VERIFICATION_CODE_LENGTH}-digit code to ${email}.`);
      setStep("verify");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        setError(await readError(res, "Could not verify your email."));
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError(await readError(res, "Could not resend the code."));
        return;
      }
      setNotice(`We sent a new code to ${email}.`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  }

  if (step === "verify") {
    return (
      <form onSubmit={onVerify} className="space-y-4" noValidate>
        {notice && <p className="text-muted text-sm">{notice}</p>}
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={VERIFICATION_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
          <p className="text-muted text-xs">
            Enter the {VERIFICATION_CODE_LENGTH}-digit code we emailed you. It expires
            shortly.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Verifying…" : "Verify and create account"}
        </Button>
        <div className="text-muted flex items-center justify-between text-sm">
          <button
            type="button"
            className="hover:text-foreground underline"
            onClick={() => {
              setStep("details");
              setCode("");
              setError(null);
              setNotice(null);
            }}
          >
            Change email
          </button>
          <button
            type="button"
            className="hover:text-foreground underline disabled:opacity-50"
            onClick={onResend}
            disabled={resending}
          >
            {resending ? "Sending…" : "Resend code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onDetails} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name (optional)</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="text-muted text-xs">At least {PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Sending code…" : "Continue"}
      </Button>
    </form>
  );
}

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Build your own private library on Shelf."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <React.Suspense fallback={null}>
        <SignupForm />
      </React.Suspense>
    </AuthShell>
  );
}
