'use client';

import type { CheckOption } from '../lib/types';

/**
 * THE CHECKLIST.
 *
 * Most of what a QA engineer wants verified is the same on every page: does it
 * load, does it error, do the forms validate. Making those tickable removes the
 * hardest part of using this tool — knowing what to write.
 *
 * The list comes from the backend (/api/capabilities), so a box can never appear
 * here without a matching instruction behind it.
 */
export function CheckPicker({
  options,
  selected,
  onChange,
  hasCredentials,
}: {
  options: CheckOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  hasCredentials: boolean;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const groups = Array.from(new Set(options.map((o) => o.group)));

  const setAll = (on: boolean) =>
    onChange(
      on
        ? options.filter((o) => !o.requiresCredentials || hasCredentials).map((o) => o.id)
        : [],
    );

  return (
    <div>
      <div className="spread" style={{ marginBottom: 8 }}>
        <span className="faint">
          {selected.length} selected
        </span>
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(true)}>
            Select all
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(false)}>
            Clear
          </button>
        </span>
      </div>

      <div className="stack-sm">
        {groups.map((group) => (
          <div key={group}>
            <div className="nav-label" style={{ padding: '6px 0 3px', marginTop: 0 }}>
              {group}
            </div>
            <div className="check-grid">
              {options
                .filter((o) => o.group === group)
                .map((o) => {
                  // Login checks are meaningless without credentials, so they are
                  // disabled with the reason shown rather than silently failing.
                  const blocked = Boolean(o.requiresCredentials) && !hasCredentials;
                  const on = selected.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`check-item ${on ? 'check-item-on' : ''} ${blocked ? 'check-item-off' : ''}`}
                      title={blocked ? 'Add test credentials below to enable this' : o.description}
                    >
                      <input
                        type="checkbox"
                        checked={on && !blocked}
                        disabled={blocked}
                        onChange={() => toggle(o.id)}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="check-label">{o.label}</span>
                        <span className="check-desc">
                          {blocked ? 'Needs test credentials' : o.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
