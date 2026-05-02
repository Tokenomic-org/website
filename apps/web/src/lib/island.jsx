import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@ui/Toast.jsx';
import { initDarkMode } from '@ui/dark-mode.jsx';

initDarkMode();

/**
 * Find every `<div data-island="<name>">`, parse its `data-props` JSON,
 * and hydrate `<Component {...props} />` inside a Toast-providing wrapper.
 *
 * Each mount is idempotent — repeated calls (e.g. after Turbo nav) re-use
 * the existing root.
 */
export function mountIsland(name, Component) {
  const nodes = document.querySelectorAll(`[data-island="${name}"]`);
  if (!nodes.length) return;
  for (const node of nodes) {
    if (node.__tknRoot) {
      node.__tknRoot.render(renderTree(Component, parseProps(node)));
      continue;
    }
    const root = createRoot(node);
    node.__tknRoot = root;
    root.render(renderTree(Component, parseProps(node)));
  }
}

function parseProps(node) {
  const raw = node.getAttribute('data-props');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (e) {
    console.warn('[island] invalid data-props JSON on', node, e);
    return {};
  }
}

function renderTree(Component, props) {
  return (
    <ToastProvider>
      <Component {...props} />
    </ToastProvider>
  );
}
