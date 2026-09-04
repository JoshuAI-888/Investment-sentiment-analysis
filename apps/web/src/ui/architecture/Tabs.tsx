'use client';

/**
 * F17 §4.4 — a generic, fully keyboard-operable tab list (WAI-ARIA APG tabs pattern).
 *
 * `ui/` may import only `contracts/` (`02-ARCHITECTURE-CONTRACTS.md` §3), so this component
 * declares its own prop shape and receives already-rendered panel content as `children` — it has
 * no idea what an "architecture tab" is, only how to be an accessible tab list.
 *
 * Every panel stays mounted in the DOM at all times (`hidden`, never `display:none` via a class
 * toggle and never an unmount) — a crawler, a find-in-page search, or a reader who disables JS
 * before hydration finishes still has every tab's content available. What client JS adds is the
 * show/hide behaviour and the roving keyboard focus, not the content itself. First paint is
 * therefore never blocked on this component doing anything — it renders the first tab visible by
 * default even before hydration, because `hidden` starts from server-rendered markup.
 */
import { useId, useRef, useState } from 'react';

export type TabDefinition = {
  readonly id: string;
  readonly label: string;
  readonly panel: React.ReactNode;
};

export type TabsProps = {
  readonly tabs: readonly TabDefinition[];
  readonly initialTabId?: string;
  readonly 'aria-label': string;
};

export function Tabs({ tabs, initialTabId, ...props }: TabsProps) {
  const firstTab = tabs[0];
  const [activeId, setActiveId] = useState<string>(initialTabId ?? firstTab?.id ?? '');
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusAndActivate(index: number) {
    const clamped = ((index % tabs.length) + tabs.length) % tabs.length;
    const target = tabs[clamped];
    if (target === undefined) return;
    setActiveId(target.id);
    tabRefs.current[target.id]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAndActivate(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAndActivate(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div data-architecture-tabs="">
      <div role="tablist" aria-label={props['aria-label']} className="flex flex-wrap gap-1 border-b border-neutral-200">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.id}
              data-selected={selected}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={
                'rounded-t-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 ' +
                (selected
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-neutral-600 hover:text-neutral-900')
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          tabIndex={0}
          data-tabpanel={tab.id}
          hidden={tab.id !== activeId}
          className="py-4 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
