import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'APOLLO_PROVIDER_RETIRED' }, { status: 410 });
}
