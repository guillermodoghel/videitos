import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EditUserForm } from "../../EditUserForm";

export default async function AdminEditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Edit user
      </h1>
      <EditUserForm user={user} />
    </div>
  );
}
