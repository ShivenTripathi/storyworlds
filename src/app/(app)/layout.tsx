import { auth } from "@clerk/nextjs/server";
import { AppHeader } from "@/components/shell/AppHeader";

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await auth.protect();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <div
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
