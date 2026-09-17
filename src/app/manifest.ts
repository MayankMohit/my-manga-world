import type { MetadataRoute } from "next";

/** Web App Manifest, served at /manifest.webmanifest (Decision D16). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shelf: private manga and comics library",
    short_name: "Shelf",
    description: "A private, self-hosted reader for your own manga, comics, and books.",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#222831",
    theme_color: "#222831",
    categories: ["books", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
