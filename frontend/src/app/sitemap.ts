import type { MetadataRoute } from "next";
import { APP_URL, INDEXABLE_PATHS, LEGAL_UPDATED } from "@/lib/site";

/** Public, indexable pages only; /admin, /profile and /s/* are deliberately absent. */
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_PATHS.map((path) => ({
    url: path === "/" ? APP_URL : `${APP_URL}${path}`,
    lastModified: new Date(LEGAL_UPDATED),
    changeFrequency: path === "/" ? "weekly" : "yearly",
    priority: path === "/" ? 1 : path === "/about" ? 0.7 : 0.4,
  }));
}
