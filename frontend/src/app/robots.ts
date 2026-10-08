import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/profile", "/s/", "/api"] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
