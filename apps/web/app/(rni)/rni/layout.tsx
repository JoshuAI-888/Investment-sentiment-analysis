import Link from 'next/link';

const links = [
  ['/rni', 'Radar'],
  ['/rni/security/nvda', 'NVDA detail'],
  ['/rni/explorer/nvda', 'Evidence'],
  ['/rni/status', 'Run status'],
  ['/rni/refresh', 'Refresh'],
  ['/rni/settings/universe', 'Universe'],
  ['/rni/settings/ai-route', 'AI route'],
  ['/admin/settings/rni-ai', 'Model limits'],
] as const;

export default function RniLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <nav aria-label="Retail Narrative Intelligence" className="border-b px-4 py-3 sm:px-8">
        <ul className="mx-auto flex max-w-7xl flex-wrap gap-x-4 gap-y-2 text-sm">
          {links.map(([href, label]) => (
            <li key={href}>
              <Link className="underline-offset-4 hover:underline focus:underline" href={href}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </>
  );
}
