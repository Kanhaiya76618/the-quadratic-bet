// Tiny DOM helpers: h() builds HTML, s() builds SVG.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  apply(node, props);
  append(node, children);
  return node;
}

export function s(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, props);
  append(node, children);
  return node;
}

// Make an SVG group behave like a button for mouse, keyboard and screen readers.
export function svgButton(group, label, onActivate, pressed) {
  group.setAttribute('role', 'button');
  group.setAttribute('tabindex', '0');
  group.setAttribute('aria-label', label);
  if (pressed !== undefined) group.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  group.addEventListener('click', onActivate);
  group.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(e);
    }
  });
  return group;
}

export function replace(container, ...children) {
  container.replaceChildren();
  append(container, children);
}
