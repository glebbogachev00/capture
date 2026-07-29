import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="capture-root gate">
      <div className="gate-in">
        <div className="capture-mark">
          capture<span>.</span>
        </div>
        {/* useSearchParams needs a boundary so the shell can prerender. */}
        <Suspense fallback={<div style={{ height: 96 }} />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
