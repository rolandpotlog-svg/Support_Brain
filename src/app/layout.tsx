import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Moderne, gut lesbare UI-Schrift (selbst gehostet über next/font — kein Google-Request im Browser).
const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Support-Brain",
  description: "Internes Support-Cockpit",
};

// Setzt das gespeicherte Theme VOR dem ersten Paint (kein Flackern).
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning className={geist.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
