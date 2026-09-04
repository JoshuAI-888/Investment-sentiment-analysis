import { NextResponse } from 'next/server';
import { loadArchitectureView } from '@/services/architecture/view';

/**
 * F17 — the manifest and public-safe projection, as JSON. `databaseAvailable: false` (no
 * `DATABASE_URL` configured) is a normal, honest state, not an error — mirrors every other
 * route in this product that distinguishes "not configured" from "a real fault".
 */
export async function GET() {
  try {
    const view = await loadArchitectureView();
    return NextResponse.json({
      state: view.databaseAvailable ? 'ready' : 'fixture',
      route: '/api/architecture',
      manifest: view.manifest,
      projection: view.projection,
      catalogueSize: view.catalogue.length,
    });
  } catch (error) {
    console.error('GET /api/architecture failed', error);
    return NextResponse.json(
      { state: 'error', route: '/api/architecture', message: 'Failed to load the architecture view.' },
      { status: 500 },
    );
  }
}
