import crypto from "crypto";
import { NextResponse } from "next/server";

const MOBILE_TOKEN_PARAM = "mobileToken";

function timingSafeEqual(firstValue: string, secondValue: string) {
  const first = Buffer.from(firstValue);
  const second = Buffer.from(secondValue);

  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function getTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const headerToken = request.headers.get("x-mobile-api-token");
  if (headerToken) {
    return headerToken.trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get(MOBILE_TOKEN_PARAM)?.trim() ?? "";
}

function isSameOriginBrowserRequest(request: Request) {
  const source = request.headers.get("referer") ?? request.headers.get("origin");
  if (!source) {
    return false;
  }

  try {
    const sourceHost = new URL(source).host;
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHosts = [
      new URL(request.url).host,
      request.headers.get("host"),
      forwardedHost
    ].filter(Boolean);

    return requestHosts.includes(sourceHost);
  } catch {
    return false;
  }
}

export function authorizeMobileApiRequest(request: Request) {
  const expectedToken = process.env.MOBILE_API_TOKEN?.trim();
  if (!expectedToken || isSameOriginBrowserRequest(request)) {
    return null;
  }

  const requestToken = getTokenFromRequest(request);
  if (requestToken && timingSafeEqual(requestToken, expectedToken)) {
    return null;
  }

  return NextResponse.json(
    { error: "Mobile API authorization is required." },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer"
      }
    }
  );
}

export function appendMobileTokenParam(url: string, token: string) {
  if (!token) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${MOBILE_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
