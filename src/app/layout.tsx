import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support-Brain",
  description: "Internes Support-Cockpit",
};

// Setzt das gespeicherte Theme VOR dem ersten Paint (kein Flackern).
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
