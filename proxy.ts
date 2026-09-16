import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPortal } from "./lib/auth/portals";
import { supabaseConfig } from "./lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  const config = supabaseConfig();
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const requestedPortal = request.nextUrl.pathname.split("/")[3];
  if (!user && request.nextUrl.pathname.startsWith("/portal/home/") && isPortal(requestedPortal)) {
    const loginResponse = NextResponse.redirect(new URL("/login/" + requestedPortal, request.url));
    response.cookies.getAll().forEach(cookie => loginResponse.cookies.set(cookie));
    loginResponse.headers.set("Cache-Control", "private, no-store");
    return loginResponse;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/portal/:path*", "/login/:path*", "/register", "/forgot-password", "/reset-password"] };
