import { Suspense } from "react";

import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
          A carregar...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
