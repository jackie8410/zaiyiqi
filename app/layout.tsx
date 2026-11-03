import type { Metadata } from "next";
import "./globals.css";
import "./album.css";

export const metadata: Metadata = {
  title: "在一起 · 把美好装订成册",
  description: "让想念的人出现在合影里，让向往的风景成为照片。创作、珍藏、分享属于你的互动相册。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
