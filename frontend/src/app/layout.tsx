import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import JsonLd from "@/components/site/JsonLd";
import { AuthProvider } from "@/lib/auth";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, APP_URL, AUTHOR_NAME, AUTHOR_URL, REPO_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const TITLE = "AskUoC - University of Cyberjaya assistant";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: TITLE, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  keywords: [
    "University of Cyberjaya",
    "UoC",
    "Cyberjaya university programmes",
    "UoC fees",
    "UoC scholarships",
    "UoC admission",
    "university chatbot",
    "AI assistant",
    "RAG",
  ],
  applicationName: APP_NAME,
  authors: [{ name: AUTHOR_NAME, ...(AUTHOR_URL ? { url: AUTHOR_URL } : {}) }],
  creator: AUTHOR_NAME,
  category: "education",
  alternates: { canonical: "./" }, // resolved per route against metadataBase
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: TITLE,
    description: APP_TAGLINE,
    locale: "en_MY",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: APP_TAGLINE },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
};

// structured data describes the app only; it must not claim to be, or be run by, the university
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: APP_NAME,
  url: APP_URL,
  description: APP_DESCRIPTION,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  browserRequirements: "Requires JavaScript",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "MYR" },
  author: { "@type": "Person", name: AUTHOR_NAME, ...(AUTHOR_URL ? { url: AUTHOR_URL } : {}) },
  ...(REPO_URL ? { codeRepository: REPO_URL, license: "https://opensource.org/licenses/MIT" } : {}),
  disclaimer:
    "Independent project, not affiliated with or endorsed by the University of Cyberjaya. Answers may be wrong - verify with the university.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // draw under the notch
  interactiveWidget: "resizes-content", // Android: the keyboard resizes the page instead of covering the composer
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#603e90" },
    { media: "(prefers-color-scheme: dark)", color: "#170c26" },
  ],
};

// runs before paint so the theme applies without a flash
const themeScript = `try{var t=localStorage.getItem('askuoc_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full touch-manipulation bg-uoc-50 text-slate-900 dark:bg-uoc-950 dark:text-slate-100">
        <AuthProvider>{children}</AuthProvider>
        <JsonLd data={jsonLd} />
      </body>
    </html>
  );
}
