import { NextResponse } from 'next/server';
import { getDb } from '@clawd/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Quick database connectivity check
    await getDb().$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'clawd-admin',
        version: process.env.npm_package_version ?? '0.1.0',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Health check failed:', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'clawd-admin',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}