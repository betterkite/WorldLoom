import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(_req: NextRequest) {
  const response = NextResponse.next();
  // HSTS is runtime-gated because TLS termination is a deployment concern.
  if (process.env.WORLDLOOM_TLS_TERMINATED === 'true') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)'
  ]
};
