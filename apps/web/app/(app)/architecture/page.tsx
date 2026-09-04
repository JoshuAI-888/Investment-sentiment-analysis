import { ArchitecturePage } from './ArchitecturePage';

/**
 * Forces per-request rendering. Nothing on this route reads a cookie or a header — the only
 * signal Next.js would otherwise use to infer a dynamic page — so without this it would be
 * statically generated once at build time and every visitor after that would see whichever
 * config/settings/model-route values happened to be active the moment `pnpm build` ran. That is
 * exactly the frozen, hand-copied-at-one-point-in-time value F17 §4.1 exists to prevent; the
 * public-safe projection has to be live, not baked in.
 */
export const dynamic = 'force-dynamic';

export default function Page() {
  return <ArchitecturePage />;
}
