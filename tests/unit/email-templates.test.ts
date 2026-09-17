import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  verificationCodeEmail,
  welcomeEmail,
  passwordResetEmail,
  passwordChangedEmail,
  type EmailContent,
} from "@/lib/email/templates";

const all = (c: EmailContent) => `${c.subject}\n${c.html}\n${c.text}`;

describe("escapeHtml", () => {
  it("escapes markup-significant characters", () => {
    expect(escapeHtml(`<b>"a"&'b'`)).toBe("&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;");
  });
});

describe("email templates", () => {
  it("verification email embeds the code and expiry", () => {
    const c = verificationCodeEmail({ code: "123456", name: "Mai", ttlMinutes: 10 });
    expect(c.subject).toBeTruthy();
    expect(c.html).toContain("123456");
    expect(c.text).toContain("123456");
    expect(all(c)).toContain("10 minutes");
  });

  it("welcome email links to the library", () => {
    const c = welcomeEmail({ name: "Mai", appUrl: "https://shelf.test" });
    expect(all(c)).toContain("https://shelf.test/library");
  });

  it("reset email embeds the reset url", () => {
    const c = passwordResetEmail({
      resetUrl: "https://shelf.test/reset-password?token=abc",
      ttlMinutes: 60,
    });
    expect(c.html).toContain("https://shelf.test/reset-password?token=abc");
    expect(c.text).toContain("https://shelf.test/reset-password?token=abc");
  });

  it("password-changed email links to sign in", () => {
    const c = passwordChangedEmail({ appUrl: "https://shelf.test" });
    expect(all(c)).toContain("https://shelf.test/login");
  });

  it("escapes a name with markup", () => {
    const c = welcomeEmail({ name: "<script>", appUrl: "https://shelf.test" });
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;");
  });

  it("contains no em dashes in any copy (project rule)", () => {
    const emails = [
      verificationCodeEmail({ code: "000000", ttlMinutes: 10 }),
      welcomeEmail({ appUrl: "https://shelf.test" }),
      passwordResetEmail({ resetUrl: "https://shelf.test/x", ttlMinutes: 60 }),
      passwordChangedEmail({ appUrl: "https://shelf.test" }),
    ];
    for (const c of emails) {
      expect(all(c)).not.toContain("—");
    }
  });
});
