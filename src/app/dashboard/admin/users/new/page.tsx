import { NewUserForm } from "../NewUserForm";

export default function AdminNewUserPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        New user
      </h1>
      <NewUserForm />
    </div>
  );
}
