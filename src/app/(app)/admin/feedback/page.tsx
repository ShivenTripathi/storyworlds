import Link from "next/link";
import { AdminFeedback } from "@/components/admin/AdminFeedback";
import { requireUser } from "@/lib/auth";

export default async function AdminFeedbackPage() {
  const { role } = await requireUser();

  if (role !== "admin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        <p className="eyebrow mb-6">THE PRESS ROOM</p>
        <h1 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">
          This door is locked.
        </h1>
        <p className="mt-6 max-w-md font-ui text-base opacity-70">
          The press room is reserved for the library&apos;s keepers.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/admin"
          className="font-ui text-sm text-muted-foreground hover:text-foreground"
        >
          ← Admin
        </Link>
        <p className="eyebrow mt-3 mb-2">READER MAIL</p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          Feedback
        </h1>
      </div>

      <AdminFeedback />
    </div>
  );
}
