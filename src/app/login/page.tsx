import { Suspense } from "react";
import { utilityMetadata } from "@/lib/seo";
import { getCloudConfig } from "@/lib/supabase/config";
import { CloudLoginForm } from "@/components/CloudLoginForm";
import { LoginForm } from "./LoginForm";

export const metadata = utilityMetadata("Login");

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cloud = getCloudConfig();
  const cloudReady = cloud?.status === "ready";
  const params = await searchParams;
  const nextPath = typeof params.next === "string" ? params.next : null;

  return (
    <div className={`capture-root gate${cloudReady ? " cloud-gate" : ""}`}>
      <div className="gate-in">
        <div className="capture-mark">
          capture<span>.</span>
        </div>
        {cloudReady ? (
          <CloudLoginForm config={cloud} nextPath={nextPath} />
        ) : (
          /* useSearchParams needs a boundary so the legacy shell can prerender. */
          <Suspense fallback={<div style={{ height: 96 }} />}>
            <LoginForm />
          </Suspense>
        )}
      </div>
    </div>
  );
}
