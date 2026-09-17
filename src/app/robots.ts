import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Only the public shell is indexable; all private/app routes are disallowed. */
export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/signup", "/forgot-password", "/upload"],
      disallow: [
        "/library",
        "/series",
        "/read",
        "/settings",
        "/accept",
        "/reset-password",
        "/api",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
