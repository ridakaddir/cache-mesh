import { NextResponse } from 'next/server';
import { getCache } from '../../../../lib/cache';

// Important: Edge runtime is not supported — cache-sync needs node:http/node:dns.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Product = { id: string; name: string; price: number };

async function fetchFromSourceOfTruth(id: string): Promise<Product> {
  // Replace with your real DB call.
  return { id, name: `Product ${id}`, price: 42 };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const cache = getCache();

  const cached = cache.get(id);
  if (cached) return NextResponse.json({ source: 'cache', product: cached });

  const fresh = await fetchFromSourceOfTruth(id);
  cache.set(id, fresh); // local + broadcast to sibling pods
  return NextResponse.json({ source: 'origin', product: fresh });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  getCache().delete(id); // invalidate across all pods
  return new NextResponse(null, { status: 204 });
}
