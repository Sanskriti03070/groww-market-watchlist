import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Restrained blue, same tone family as the page's pale-blue background
// (see app/globals.css's --page-top) - just a deeper, icon-legible shade
// of the same hue. No glyph, no gradient: a plain rounded fill.
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 7,
        background: "#2F5F94",
      }}
    />,
    { ...size },
  );
}
