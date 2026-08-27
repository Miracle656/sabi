import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono, Roboto } from "next/font/google";
import "./globals.css";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// Roboto is Cortex's body face; Archivo stands in for Cortex's Expose (Fontshare,
// which we do not want as a render-blocking third-party at this size). Geist Mono
// is the one addition: memory ids are hashes and must not be set proportionally.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-roboto",
  display: "swap",
});
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sabi — the community brain wey no dey forget",
  description:
    "Verified Nigerian web3 & fintech dev landmines, remembered on Walrus and recalled by any AI model.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Runs before first paint so a chosen theme never flashes the other one.
// Only ever writes data-theme; "system" leaves the attribute off so the
// prefers-color-scheme rules in globals.css take over.
const NO_FLASH = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",t==="dark"?"#000000":"#ffffff");}}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${roboto.variable} ${archivo.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
