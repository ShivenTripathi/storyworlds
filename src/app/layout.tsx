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

// EX LIBRIS theming for Clerk's hosted UI (sign-in/up forms, the UserButton
// popover, org/account modals). `variables` map 1:1 onto our CSS custom
// properties (globals.css) — Clerk renders these into inline styles in the
// page's own DOM, so `var(--token)` resolves live against whatever
// [data-app-theme] is active, light or dark, no duplicate palette to
// maintain. `elements` only touches the handful of surfaces that otherwise
// ship Clerk's default drop shadows/rounded-white-card look, which reads as
// visibly foreign against the "lamplit library" aesthetic; deliberately not
// exhaustive so we don't end up re-implementing Clerk's internals here.
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--card-foreground)",
    colorInput: "var(--input)",
    colorInputForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorBorder: "var(--border)",
    colorDanger: "var(--destructive)",
    colorRing: "var(--ring)",
    colorShadow: "var(--scrim)",
    fontFamily: "var(--font-ui), ui-sans-serif, system-ui, sans-serif",
    fontFamilyButtons: "var(--font-ui), ui-sans-serif, system-ui, sans-serif",
    borderRadius: "var(--radius)",
  },
  elements: {
    card: "shadow-none border border-[var(--border)] bg-[var(--card)]",
    formButtonPrimary:
      "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 normal-case shadow-none",
    footerActionLink: "text-[var(--primary)] hover:opacity-80",
    userButtonPopoverCard:
      "shadow-none border border-[var(--border)] bg-[var(--card)]",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      // Branded in-app routes (src/app/sign-in, src/app/sign-up) instead of
      // Clerk's hosted Account Portal. NEXT_PUBLIC_CLERK_SIGN_IN_URL /
      // NEXT_PUBLIC_CLERK_SIGN_UP_URL (see .env.example) cover the
      // server-side redirect in auth.protect(); these props cover the
      // client bundle (and keep keyless/dev working with no env vars set).
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
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
