import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AskUoC - University of Cyberjaya assistant",
    short_name: "AskUoC",
    description: "Ask about programmes, fees, scholarships and campus life at the University of Cyberjaya.",
    start_url: "/",
    display: "standalone",
    background_color: "#170c26",
    theme_color: "#603e90",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
