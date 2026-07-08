import { AdminClient } from "@/components/admin/AdminClient";
import { requireUser } from "@/lib/auth";

export default async function AdminPage() {
  const { role } = await requireUser();

  if (role !== "admin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        <p className="eyebrow mb-6">THE PRESS ROOM</p>
        <h1 className="font-display max-w-xl text-4xl leading-tight sm:text-5xl">
          This door is locked.
        </h1>
        <p className="font-ui mt-6 max-w-md text-base opacity-70">
          The press room is reserved for the library&apos;s keepers.
        </p>
      </div>
    );
  }

  return <AdminClient />;
}
