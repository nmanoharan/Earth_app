import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "US Dynamic World Land Cover Explorer",
  description: "Prototype map for Google Earth Engine Dynamic World land-cover exploration."
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
