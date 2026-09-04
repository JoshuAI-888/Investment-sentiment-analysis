/**
 * What the drawer slot renders when nothing is intercepted. Without this file Next.js has no
 * fallback for the slot on a hard navigation and the route 404s — the failure mode parallel
 * routes are notorious for, and the reason this shell exists from F01.
 */
export default function Default() {
  return null;
}
