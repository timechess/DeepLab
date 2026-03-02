import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';

const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL?.trim() || 'http://127.0.0.1:8000';

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const resolved = await params;
  const backendPath = resolved.path.join('/');
  const url = new URL(backendPath, `${BACKEND_BASE_URL}/`);
  url.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const arrayBuffer = await request.arrayBuffer();
    body = arrayBuffer.byteLength > 0 ? arrayBuffer : undefined;
  }

  try {
    const backendResponse = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });

    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.delete('content-length');

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backend proxy failed';
    return Response.json({ detail: message }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}
