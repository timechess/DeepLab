import { Atkinson_Hyperlegible, Crimson_Pro } from "next/font/google";
import { LayoutChrome } from "@/components/LayoutChrome";
import "@/styles/globals.css";

const crimson = Crimson_Pro({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${crimson.variable} ${atkinson.variable} antialiased`}>
        <LayoutChrome />
        {children}
      </body>
    </html>
  );
}
