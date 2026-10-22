import type { EngineInfo } from '../../../shared/protocol';
import { h } from '../dom';
import { on, store } from '../store';
import { conn } from '../ws';

const DATA_FILE = /\.(json|md|txt|nnue|bin|dll|so|dylib|ini|cfg)$/i;

/** The number in a version name ('v12' → 12); an engine without versions counts as 1. */
const versionNum = (v?: string) => Number(v?.match(/\d+/)?.[0] ?? 1);

/** Next free version name for an engine family, e.g. 'v3'. */
function nextVersion(family: string) {
  const versions = store.engines.filter((e) => e.family === family).map((e) => versionNum(e.version));
  return `v${versions.length ? Math.max(...versions) + 1 : 1}`;
}

/**
 * Collapsible list of engines, grouped by engine with their versions. "Add engine"
 * uploads a new engine; a file named like an existing engine becomes its next
 * version. "New version" on an engine uploads the next version of it.
 */
export function enginesSection(): HTMLElement {
  const list = h('ul.engine-list');
  const status = h('p.upload-status', { role: 'status' });
  const picker = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Engine file' });
  /** Engine the next pick is a new version of; null: derive it from the file name. */
  let target: string | null = null;
  const pick = (family: string | null) => {
    target = family;
    picker.click();
  };
  const addBtn = h('button.btn.ghost.add-engine', { type: 'button', onclick: () => pick(null) }, 'Add engine');
  picker.addEventListener('change', async () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (!files.length) return;
    // All files of one pick (engine + network files) go into one version folder.
    const main = files.find((f) => !DATA_FILE.test(f.name)) ?? files[0];
    const family = target ?? main.name.replace(/\.(py|js|mjs|sh|exe)$/i, '').replace(/[^\w.+-]/g, '_');
    const version = nextVersion(family);
    addBtn.disabled = true;
    try {
      for (const f of files) {
        status.textContent = `Adding ${family} ${version}: ${f.name} (${(f.size / 1e6).toFixed(1)} MB)…`;
        const q = new URLSearchParams({ engine: family, version, name: f.name });
        const res = await fetch(`/api/engines/upload?${q}`, { method: 'POST', body: f });
        if (!res.ok) throw new Error(await res.text());
      }
      status.textContent = `Added ${family} ${version}.`;
      conn.send({ t: 'engines.refresh' });
    } catch (err) {
      status.textContent = `Couldn't add ${main.name}: ${(err as Error).message}`;
    } finally {
      addBtn.disabled = false;
    }
  });

  const count = h('span.count');
  const details = h(
    'details.engines',
    {},
    h('summary', {}, 'Engines', count),
    list,
    h('div.engine-add', {}, addBtn, picker, status),
    h('button.link-btn', { type: 'button', onclick: () => conn.send({ t: 'engines.refresh' }) }, 'Rescan engines folder'),
  );

  // Clicking a name turns it into a text field; Enter or leaving the field saves, Esc cancels.
  let editing: string | null = null;
  const rename = (id: string, name: string) => {
    const value = name.trim();
    const e = store.engines.find((x) => x.id === id);
    const current = e?.version ? (e.label ?? e.version) : e?.name;
    editing = null;
    if (value && value !== current) conn.send({ t: 'engines.rename', id, name: value });
    render();
  };
  const nameEl = (e: EngineInfo) => {
    const shown = e.version ? (e.label ?? e.version) : e.name;
    if (editing !== e.id) {
      return h('button.e-name', { type: 'button', title: 'Rename', onclick: () => ((editing = e.id), render()) }, shown);
    }
    const input = h('input.e-rename', { type: 'text', value: shown, maxLength: 60, 'aria-label': `New name for ${e.name}` });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) rename(e.id, input.value);
      else ((editing = null), render());
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => (input.focus(), input.select()));
    return input;
  };

  const remove = (e: EngineInfo) => {
    const what = e.version ? `${e.name} (the whole ${e.family}/${e.version} folder)` : e.name;
    if (e.source === 'auto' && !confirm(`Delete ${what} from the engines folder?`)) return;
    conn.send({ t: 'engines.remove', id: e.id });
  };

  const row = (e: EngineInfo, cls = '') =>
    h(
      'li',
      { class: `${e.status} ${cls}`, title: e.error ?? e.command },
      h('span.status-dot'),
      nameEl(e),
      e.host ? h('span.e-host', { title: `Runs on the engine host (${e.host})` }, e.host) : null,
      e.status === 'error' ? h('span.e-err', {}, e.error ?? 'failed') : null,
      h('button.x', { 'aria-label': `Remove ${e.name}`, title: 'Remove', onclick: () => remove(e) }, '×'),
    );
  const newVersionBtn = (family: string) =>
    h('button.e-newver', { type: 'button', title: `Upload a new version of ${family}`, onclick: () => pick(family) }, '+ version');

  const render = () => {
    count.textContent = String(store.engines.length);
    const families = new Map<string, EngineInfo[]>();
    for (const e of store.engines) {
      const key = e.family ?? e.id;
      families.set(key, [...(families.get(key) ?? []), e]);
    }
    const items: HTMLElement[] = [];
    for (const [family, engines] of families) {
      const versioned = engines.some((e) => e.version);
      if (!versioned) {
        for (const e of engines) {
          const li = row(e);
          if (e.family) li.insertBefore(newVersionBtn(e.family), li.querySelector('.x'));
          items.push(li);
        }
        continue;
      }
      items.push(h('li.e-family', {}, h('span.e-fam-name', {}, family), h('span.count', {}, `${engines.length}`), newVersionBtn(family)));
      engines.forEach((e, k) => items.push(row(e, k === 0 ? 'e-version latest' : 'e-version')));
    }
    list.replaceChildren(...(items.length ? items : [h('li.empty', {}, 'No engines yet. Click Add engine and pick your engine file.')]));
    if (!store.engines.some((e) => e.status === 'ok')) details.open = true;
  };
  on('engines', render);
  render();
  return details;
}

/** <select> of working engines (plus optional extra options first). */
export function engineSelect(label: string, extra: { value: string; label: string }[] = [], cls = ''): HTMLSelectElement {
  const sel = h('select', { 'aria-label': label, class: cls });
  const render = () => {
    const prev = sel.value;
    sel.replaceChildren(
      ...extra.map((o) => h('option', { value: o.value }, o.label)),
      ...store.engines.filter((e) => e.status === 'ok').map((e) => h('option', { value: e.id }, e.name)),
    );
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    sel.dispatchEvent(new Event('populated'));
  };
  on('engines', render);
  render();
  return sel;
}

/**
 * Strength picker for the engine chosen in `engine`: "Full strength" or an Elo,
 * shown only when that engine supports playing at a set Elo (UCI_Elo).
 * `value()` is the chosen Elo, or undefined for full strength.
 */
export function strengthSelect(engine: HTMLSelectElement, label: string) {
  const sel = h('select.strength', { 'aria-label': label });
  let forId = '';
  const render = () => {
    const e = store.engines.find((x) => x.id === engine.value);
    sel.hidden = !e?.elo;
    if (!e?.elo || e.id === forId) return;
    forId = e.id;
    const { min, max } = e.elo;
    const steps = [min];
    for (let v = Math.ceil((min + 1) / 100) * 100; v < max; v += 100) steps.push(v);
    steps.push(max);
    sel.replaceChildren(
      h('option', { value: '' }, 'Full strength'),
      ...steps.map((v) => h('option', { value: String(v) }, `Elo ${v}`)),
    );
  };
  engine.addEventListener('change', render);
  engine.addEventListener('populated', render);
  on('engines', render);
  render();
  return { el: sel, value: () => (sel.hidden || !sel.value ? undefined : Number(sel.value)) };
}

/** Row of toggle chips; returns the element, a getter for the chosen value, and `clear()` to unselect all. */
export function chips<T>(options: { label: string; value: T }[], initial = 0, onChange?: (v: T) => void) {
  let current = options[initial].value;
  const el = h('div.chips', { role: 'radiogroup' });
  const buttons = options.map((o, i) =>
    h(
      'button.chip',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': i === initial ? 'true' : 'false',
        onclick: () => {
          current = o.value;
          buttons.forEach((b, k) => b.setAttribute('aria-checked', k === i ? 'true' : 'false'));
          onChange?.(o.value);
        },
      },
      o.label,
    ),
  );
  el.append(...buttons);
  const clear = () => buttons.forEach((b) => b.setAttribute('aria-checked', 'false'));
  return { el, get: () => current, clear };
}
