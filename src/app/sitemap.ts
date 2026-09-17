import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Public routes only; private content is never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.APP_URL.replace(/\/$/, "");
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    {
      url: `${base}/upload`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { url: `${base}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    {
      url: `${base}/signup`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
