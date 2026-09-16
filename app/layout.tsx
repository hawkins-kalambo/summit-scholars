import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summit ScholarsBridge Academic Solutions",
  description: "Structured university academic support, online and face-to-face.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
