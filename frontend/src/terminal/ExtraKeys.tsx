// The touch-only extra-keys bar: keys a soft keyboard lacks. Taps never take focus, so
// the soft keyboard stays up.
import { useSyncExternalStore } from 'react';
import { EXTRA_KEYS, type ExtraKeyId, type Modifiers, type ModName } from './extraKeys';

type Props = { mods: Modifiers; onKey(id: ExtraKeyId): void };

export function ExtraKeys({ mods, onKey }: Props) {
  const state = useSyncExternalStore(mods.subscribe, mods.get);
  return (
    <div role="toolbar" aria-label="Extra keys" className="extra-keys">
      {EXTRA_KEYS.map((k) => {
        const mod = k.kind === 'mod' ? state[k.id as ModName] : undefined;
        return (
          <button
            key={k.id}
            type="button"
            tabIndex={-1}
            className="extra-key"
            aria-label={k.name}
            aria-pressed={mod === undefined ? undefined : mod !== 'off'}
            data-mod-state={mod}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => (mod === undefined ? onKey(k.id) : mods.tap(k.id as ModName))}
          >
            {k.label}
          </button>
        );
      })}
    </div>
  );
}
