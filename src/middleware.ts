import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAppRoute = request.nextUrl.pathname.startsWith("/app");
  const isMobileRoute = request.nextUrl.pathname.startsWith("/mobile");
  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");
  const viewMode = request.cookies.get("view_mode")?.value;
  const userAgent = request.headers.get("user-agent") ?? "";
  const isMobileUserAgent =
    /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent);

  if (!user && (isAppRoute || isMobileRoute)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (user) {
    if (viewMode === "simple" && isAppRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/mobile";
      return NextResponse.redirect(redirectUrl);
    }
    if (viewMode === "pro" && isMobileRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/app";
      return NextResponse.redirect(redirectUrl);
    }
    if (!viewMode && isMobileUserAgent && isAppRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/mobile";
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (user && isLoginRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/app";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/mobile", "/login"],
};
