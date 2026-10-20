import { h } from '../dom';
import { on, store } from '../store';
import { conn } from '../ws';

/** Collapsible list of engines with an "add engine" form. */
export function enginesSection(): HTMLElement {
  const list = h('ul.engine-list');
  const name = h('input', { placeholder: 'Name (optional)', 'aria-label': 'Engine name' });
  const cmd = h('input', { placeholder: 'Path, e.g. /engines/myengine', 'aria-label': 'Engine path or command' });
  const form = h(
    'form.engine-add',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const parts = cmd.value.trim().split(/\s+/);
        if (!parts[0]) return cmd.focus();
        conn.send({ t: 'engines.add', name: name.value, command: parts[0], args: parts.slice(1) });
        name.value = cmd.value = '';
      },
    },
    cmd,
    name,
    h('button.btn.ghost', { type: 'submit' }, 'Add engine'),
  );
  const count = h('span.count');
  const details = h(
    'details.engines',
    {},
    h('summary', {}, 'Engines', count),
    list,
    form,
    h('button.link-btn', { type: 'button', onclick: () => conn.send({ t: 'engines.refresh' }) }, 'Rescan engines folder'),
  );

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
              e.source === 'config'
                ? h('button.x', { 'aria-label': `Remove ${e.name}`, onclick: () => conn.send({ t: 'engines.remove', id: e.id }) }, '×')
                : null,
            ),
          )
        : [h('li.empty', {}, 'No engines yet. Put UCI engines in the engines folder, or add one by path below.')]),
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
