import { NextRequest, NextResponse } from "next/server";

// Security headers + Content Security Policy with a per-request nonce.
//
// Next.js renders its own inline bootstrap scripts with the nonce it reads
// from the `x-nonce` request header, and the theme FOUC script in
// `app/layout.tsx` reads the same nonce via `headers()`. Nothing else in the
// app runs inline scripts, so production CSP allows only same-origin and
// nonce'd ('strict-dynamic') scripts — no 'unsafe-inline', no 'unsafe-eval'.
// Dev mode adds 'unsafe-eval' so Next.js's dev tooling/hot-reload keeps
// working; production stays strict.
const isProd = process.env.NODE_ENV === "production";

const supabaseOrigin = (() => {
  try {
    return new URL(process.env.TELEX_PUBLIC_SUPABASE_URL || "").origin;
  } catch {
    return "";
  }
})();

function buildCsp(nonce: string) {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Inline style attributes are used by the toolbar/menu components.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  // Proxy runs on the Node.js runtime. Any URL-safe token satisfies CSP, so the
  // global Web Crypto UUID is plenty (and needs no encoding).
  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), autoplay=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (proto === "https")
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );

  // Never let shared caches serve admin/API responses.
  if (request.nextUrl.pathname.startsWith("/api/"))
    response.headers.set("Cache-Control", "no-store, max-age=0");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};