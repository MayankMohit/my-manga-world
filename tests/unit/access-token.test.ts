import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/access-token";
import { JWT_AUDIENCE } from "@/lib/auth/constants";
import { env } from "@/lib/env";

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

describe("access tokens", () => {
  it("signs and verifies a token, round-tripping claims", async () => {
    const { token, jti, exp } = await signAccessToken({
      userId: "u1",
      sessionId: "s1",
      tokenVersion: 3,
    });
    const payload = await verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("u1");
    expect(payload?.sid).toBe("s1");
    expect(payload?.tv).toBe(3);
    expect(payload?.jti).toBe(jti);
    expect(payload?.exp).toBe(exp);
  });

  it("returns null for a tampered token", async () => {
    const { token } = await signAccessToken({
      userId: "u1",
      sessionId: "s1",
      tokenVersion: 0,
    });
    const tampered = token.slice(0, -3) + (token.endsWith("a") ? "bbb" : "aaa");
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ sid: "s1", tv: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setJti("j1")
      .setIssuedAt()
      .setIssuer(env.APP_URL)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("a-totally-different-secret-value-xx"));
    expect(await verifyAccessToken(foreign)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const expired = await new SignJWT({ sid: "s1", tv: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setJti("j1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(env.APP_URL)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    expect(await verifyAccessToken(expired)).toBeNull();
  });

  it("returns null for garbage input", async () => {
    expect(await verifyAccessToken("not.a.jwt")).toBeNull();
    expect(await verifyAccessToken("")).toBeNull();
  });
});
