import { ImageResponse } from "next/og";

export const alt = "Shelf: your private manga and comics library";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Open Graph image for the public landing page. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#222831",
        color: "#EEEEEE",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: "#76ABAE",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#10201f",
            fontSize: 44,
            fontWeight: 800,
          }}
        >
          S
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#76ABAE" }}>Shelf</div>
      </div>
      <div style={{ fontSize: 68, fontWeight: 800, marginTop: 48, lineHeight: 1.1 }}>
        Your private manga and comics library
      </div>
      <div style={{ fontSize: 32, marginTop: 24, color: "rgba(238,238,238,0.7)" }}>
        Upload your archives. Read anywhere. Progress syncs across devices.
      </div>
    </div>,
    size,
  );
}
