import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const responseUrl = new URL("/login?verification=failed", request.url);
  if (supabaseConfig() && tokenHash && (type === "email" || type === "recovery")) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) {
        responseUrl.pathname = type === "recovery" ? "/reset-password" : "/portal";
        responseUrl.search = "";
      }
    } catch { /* Expired/invalid links return a recoverable login destination. */ }
  }
  const response = NextResponse.redirect(responseUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
