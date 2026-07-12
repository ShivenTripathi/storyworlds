import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { fraunces, literata, instrumentSans } from "@/theme/fonts";
import { SoundProvider } from "@/components/sound/SoundProvider";
import "./globals.css";
import "@/theme/archetypes.css";

export const metadata: Metadata = {
  title: "Story Worlds — Great books, fully alive",
  description:
    "Not summaries. Read the real thing — with the world rendered around you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${fraunces.variable} ${literata.variable} ${instrumentSans.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col bg-[var(--background)] font-ui text-[var(--foreground)]">
          <SoundProvider />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
