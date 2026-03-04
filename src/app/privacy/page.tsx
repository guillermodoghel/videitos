import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Videitos",
  description: "Privacy policy for Videitos – how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-12 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl space-y-8 text-zinc-700 dark:text-zinc-300">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Videitos
          </Link>
        </div>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            Privacy Policy
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Last updated: March 2025
          </p>
        </header>

        <main className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              1. Introduction
            </h2>
            <p>
              Videitos (&quot;we&quot;, &quot;our&quot;, or &quot;the app&quot;) is a video generation service that lets you create videos from templates and images. This policy describes what data we collect, how we use it, and how we protect it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              2. Data we collect and use
            </h2>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong>Account and session data:</strong> When you sign in (e.g. via the provided auth flow), we store what is needed to identify you and keep you logged in (e.g. user id, session token). We do not store passwords in plain text.
              </li>
              <li>
                <strong>Dropbox connection:</strong> If you connect Dropbox, we store OAuth tokens to access the folders you link to templates. We only access the specific folders you designate for each template, to list files and create video generation jobs when new images are added.
              </li>
              <li>
                <strong>Templates and reference images:</strong> Template names, settings, and reference images you upload or link are stored so we can run video generation (e.g. with AI/video APIs). Reference images may be sent to third-party services that perform the generation.
              </li>
              <li>
                <strong>Jobs and status:</strong> We store job records (e.g. status, inputs, outputs, error messages) so you can see history and we can retry or debug when needed.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              3. Third-party services
            </h2>
            <p>
              We use external services to run the app. Data may be processed or stored by:
            </p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong>Hosting and database:</strong> Our app and database are hosted by our chosen provider (e.g. Vercel, Supabase); their privacy and security policies apply to data stored there.
              </li>
              <li>
                <strong>Dropbox:</strong> When you connect Dropbox, Dropbox&apos;s terms and privacy policy apply to that connection and the data we access with your consent.
              </li>
              <li>
                <strong>Cloud and AI providers:</strong> We use cloud and AI services (e.g. Google Cloud, AWS, and video/AI APIs) for tasks such as job queues, storage, and video generation. Reference images and job parameters may be sent to these providers to perform the service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              4. Cookies and local storage
            </h2>
            <p>
              We use session and authentication mechanisms (e.g. cookies or similar) to keep you logged in and to remember preferences (such as theme). We do not use third-party advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              5. Data retention and security
            </h2>
            <p>
              We retain your data for as long as your account exists and as needed to operate the service and comply with law. We take reasonable measures to protect data in transit and at rest. If you disconnect Dropbox or delete templates, we stop using the related tokens and data for new processing; existing job records may be kept for history and support.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              6. Your choices
            </h2>
            <p>
              You can disconnect Dropbox from settings, delete or edit templates, and stop using the app at any time. If you want to delete your account or request a copy or deletion of your data, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
              7. Changes and contact
            </h2>
            <p>
              We may update this policy from time to time; the &quot;Last updated&quot; date at the top will change when we do. Continued use of the app after changes means you accept the updated policy. For questions or requests about this policy or your data, contact the operator of this Videitos instance (e.g. the team or organization that provided you the app URL).
            </p>
          </section>
        </main>

        <footer className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Back to Videitos
          </Link>
        </footer>
      </div>
    </div>
  );
}
