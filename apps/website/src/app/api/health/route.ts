import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'clawd-website',
      version: process.env.npm_package_version ?? '0.1.0',
    },
    { status: 200 }
  );
}