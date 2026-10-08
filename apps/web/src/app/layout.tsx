import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OEOC Dashboard",
  description: "One Earth One Chance environmental impact dashboard."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
