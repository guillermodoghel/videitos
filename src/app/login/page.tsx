import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PublicNav } from "../PublicNav";
import { LoginForm } from "../LoginForm";

export const metadata = {
  title: "Log in | Videitos",
  description: "Sign in to your Videitos account.",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <PublicNav />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <LoginForm />
      </div>
    </div>
  );
}
