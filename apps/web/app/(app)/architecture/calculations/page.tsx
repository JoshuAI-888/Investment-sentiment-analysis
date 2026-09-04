import { CataloguePage } from './CataloguePage';

/** See `app/(app)/architecture/page.tsx`'s own comment — the same reasoning applies here. */
export const dynamic = 'force-dynamic';

export default function Page() {
  return <CataloguePage />;
}
