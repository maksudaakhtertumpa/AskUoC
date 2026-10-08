import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/site";

export const alt = "AskUoC - an independent AI assistant for questions about the University of Cyberjaya";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// static brand card: no network, uses the font bundled with next/og
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        color: "white",
        background: "linear-gradient(135deg, #2b1b42 0%, #603e90 55%, #d33d8f 120%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
            fontWeight: 700,
            background: "linear-gradient(135deg, #7f58b8, #d33d8f)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          }}
        >
          U
        </div>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>{APP_NAME}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
          Ask anything about the University of Cyberjaya
        </div>
        <div style={{ fontSize: 34, color: "#ede5f8", maxWidth: 900 }}>
          Answers with cited sources from the university&apos;s public website.
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#dccdf1" }}>
        <div>Independent project - not affiliated with the university</div>
        <div style={{ display: "flex" }}>Free · Open source</div>
      </div>
    </div>,
    size,
  );
}
