import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./practice.css";
import "./review.css";

export function generateMetadata(): Metadata {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://zhiyin-guzheng-practice.jolly-rhea-7956.chatgpt.site";
  const title = "知音 · 古筝智能陪练";
  const description = "看简谱练习，实时获得古筝音高与节奏反馈。";

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s · 知音",
    },
    description,
    applicationName: "知音古筝智能陪练",
    icons: {
      icon: `${process.env.GITHUB_PAGES === "true" ? "/zhiyin-guzheng-practice" : ""}/favicon.svg`,
      shortcut: `${process.env.GITHUB_PAGES === "true" ? "/zhiyin-guzheng-practice" : ""}/favicon.svg`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3efe5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
