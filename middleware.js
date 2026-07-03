// A/B split: 0.0 = 100% variant A, 0.5 = 50/50, 1.0 = 100% variant B
const VARIANT_B_RATIO = 0.5;

export const config = {
  matcher: ['/'],
};

export default async function middleware(request) {
  const url = new URL(request.url);

  // ?preview=a or ?preview=b bypasses cookie for manual testing
  const preview = url.searchParams.get('preview');
  if (preview === 'a' || preview === 'b') {
    return serveVariant(preview, request, false);
  }

  const cookie = request.headers.get('cookie') || '';
  const existing = cookie.match(/ab_variant=([ab])/)?.[1];
  const variant = existing ?? (Math.random() < VARIANT_B_RATIO ? 'b' : 'a');

  return serveVariant(variant, request, !existing);
}

async function serveVariant(variant, request, setCookie) {
  const path = variant === 'b' ? '/design-b.html' : '/index.html';
  const target = new URL(path, request.url);

  const upstream = await fetch(target);
  const headers = new Headers(upstream.headers);

  if (setCookie) {
    headers.append(
      'Set-Cookie',
      `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
