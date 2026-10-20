import { h } from '../dom';
import { on, store } from '../store';
import { conn } from '../ws';

const DATA_FILE = /\.(json|md|txt|nnue|bin|dll|so|dylib|ini|cfg)$/i;

/** Collapsible list of engines; "Add engine" opens the file picker and uploads the pick. */
export function enginesSection(): HTMLElement {
  const list = h('ul.engine-list');
  const status = h('p.upload-status', { role: 'status' });
  const picker = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Engine file' });
  const addBtn = h('button.btn.ghost.add-engine', { type: 'button', onclick: () => picker.click() }, 'Add engine');
  picker.addEventListener('change', async () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (!files.length) return;
    // Several files (engine + network files) go into one folder named after the engine.
    const main = files.find((f) => !DATA_FILE.test(f.name)) ?? files[0];
    const folder = files.length > 1 ? main.name.replace(/\.[^.]*$/, '') : '';
    addBtn.disabled = true;
    try {
      for (const f of files) {
        status.textContent = `Adding ${f.name} (${(f.size / 1e6).toFixed(1)} MB)…`;
        const q = new URLSearchParams({ name: f.name, folder });
        const res = await fetch(`/api/engines/upload?${q}`, { method: 'POST', body: f });
        if (!res.ok) throw new Error(await res.text());
      }
      status.textContent = '';
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

  const remove = (id: string, name: string, source: string) => {
    if (source === 'auto' && !confirm(`Delete ${name} from the engines folder?`)) return;
    conn.send({ t: 'engines.remove', id });
  };

  const render = () => {
    count.textContent = String(store.engines.length);
    list.replaceChildren(
      ...(store.engines.length
        ? store.engines.map((e) =>
            h(
              'li',
              { class: e.status, title: e.error ?? e.command },
              h('span.status-dot'),
              h('span.e-name', {}, e.name),
              e.status === 'error' ? h('span.e-err', {}, e.error ?? 'failed') : null,
              h('button.x', { 'aria-label': `Remove ${e.name}`, title: 'Remove', onclick: () => remove(e.id, e.name, e.source) }, '×'),
            ),
          )
        : [h('li.empty', {}, 'No engines yet. Click Add engine and pick your engine file.')]),
    );
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

/** Row of toggle chips; returns the element and a getter for the chosen value. */
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
  return { el, get: () => current };
}
