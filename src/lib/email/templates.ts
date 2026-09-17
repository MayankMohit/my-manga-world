/**
 * Transactional email templates. Pure builders returning `{ subject, html, text }`
 * so they can be unit-tested without any network or server-only imports. Styles
 * are inlined (email clients ignore <style>/external CSS) and use the Shelf
 * palette. No em dashes in any copy (project rule).
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = "#76ABAE";
const INK = "#222831";
const SURFACE = "#31363F";
const PAPER = "#EEEEEE";

/** Minimal HTML escaping for any value interpolated into markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared dark card shell. `preheader` is the inbox preview line. */
function layout(opts: { preheader: string; heading: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${INK};color:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${SURFACE};border-radius:16px;padding:32px;">
            <tr>
              <td>
                <div style="font-size:20px;font-weight:700;color:${ACCENT};margin-bottom:24px;">Shelf</div>
                <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:${PAPER};">${escapeHtml(opts.heading)}</h1>
                ${opts.body}
              </td>
            </tr>
          </table>
          <div style="max-width:480px;color:rgba(238,238,238,0.5);font-size:12px;margin-top:20px;line-height:1.5;">
            Shelf. Your private manga and comics library.<br />
            If you did not expect this email you can safely ignore it.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="font-size:15px;line-height:1.6;color:rgba(238,238,238,0.85);margin:0 0 16px;">${text}</p>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">${escapeHtml(
    label,
  )}</a>`;
}

function greeting(name?: string): string {
  return name ? `Hi ${escapeHtml(name)},` : "Hi,";
}

/** Signup: the 6-digit verification code. */
export function verificationCodeEmail(input: {
  code: string;
  name?: string;
  ttlMinutes: number;
}): EmailContent {
  const subject = "Your Shelf verification code";
  const codeBlock = `<div style="font-size:34px;font-weight:700;letter-spacing:8px;color:${ACCENT};background:${INK};border-radius:12px;padding:18px;text-align:center;margin:0 0 16px;">${escapeHtml(
    input.code,
  )}</div>`;
  const html = layout({
    preheader: `Your Shelf verification code is ${input.code}`,
    heading: "Confirm your email",
    body: [
      paragraph(
        `${greeting(input.name)} enter this code to finish creating your Shelf account.`,
      ),
      codeBlock,
      paragraph(
        `This code expires in ${input.ttlMinutes} minutes. If you did not request it, no account has been created and you can ignore this email.`,
      ),
    ].join("\n"),
  });
  const text = [
    `${greeting(input.name)}`,
    ``,
    `Enter this code to finish creating your Shelf account:`,
    ``,
    `    ${input.code}`,
    ``,
    `This code expires in ${input.ttlMinutes} minutes. If you did not request it, you can ignore this email.`,
  ].join("\n");
  return { subject, html, text };
}

/** Sent right after the account is created. */
export function welcomeEmail(input: { name?: string; appUrl: string }): EmailContent {
  const subject = "Welcome to Shelf";
  const html = layout({
    preheader: "Your Shelf account is ready.",
    heading: "Your account is ready",
    body: [
      paragraph(
        `${greeting(input.name)} welcome to Shelf, your private library for the comics and books you own.`,
      ),
      paragraph(
        "Upload an archive, read it on any device, and your progress follows you.",
      ),
      paragraph(button(`${input.appUrl}/library`, "Open your library")),
    ].join("\n"),
  });
  const text = [
    `${greeting(input.name)}`,
    ``,
    `Welcome to Shelf, your private library for the comics and books you own.`,
    `Upload an archive, read it on any device, and your progress follows you.`,
    ``,
    `Open your library: ${input.appUrl}/library`,
  ].join("\n");
  return { subject, html, text };
}

/** Password reset request: link to the reset page. */
export function passwordResetEmail(input: {
  resetUrl: string;
  ttlMinutes: number;
}): EmailContent {
  const subject = "Reset your Shelf password";
  const html = layout({
    preheader: "Reset your Shelf password.",
    heading: "Reset your password",
    body: [
      paragraph("We received a request to reset the password for your Shelf account."),
      paragraph(button(input.resetUrl, "Choose a new password")),
      paragraph(
        `This link expires in ${input.ttlMinutes} minutes and can be used once. If you did not request a reset, you can ignore this email and your password stays the same.`,
      ),
    ].join("\n"),
  });
  const text = [
    `We received a request to reset the password for your Shelf account.`,
    ``,
    `Choose a new password: ${input.resetUrl}`,
    ``,
    `This link expires in ${input.ttlMinutes} minutes and can be used once. If you did not request a reset, you can ignore this email.`,
  ].join("\n");
  return { subject, html, text };
}

/** Confirmation after a successful password change/reset. */
export function passwordChangedEmail(input: { appUrl: string }): EmailContent {
  const subject = "Your Shelf password was changed";
  const html = layout({
    preheader: "Your Shelf password was changed.",
    heading: "Your password was changed",
    body: [
      paragraph(
        "Your Shelf password was just changed and every active session was signed out.",
      ),
      paragraph(button(`${input.appUrl}/login`, "Sign in")),
      paragraph(
        "If this was not you, reset your password immediately and contact the site operator.",
      ),
    ].join("\n"),
  });
  const text = [
    `Your Shelf password was just changed and every active session was signed out.`,
    ``,
    `Sign in: ${input.appUrl}/login`,
    ``,
    `If this was not you, reset your password immediately and contact the site operator.`,
  ].join("\n");
  return { subject, html, text };
}
