const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tg:'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.includes(url.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function sanitizeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map(sanitizeNode).join('');
  const tag = element.tagName.toLowerCase();

  if (tag === 'a') {
    const href = sanitizeHref(element.getAttribute('href') ?? '');
    return href
      ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${children}</a>`
      : children;
  }

  if (tag === 'b' || tag === 'i' || tag === 'u' || tag === 's' || tag === 'code') {
    return `<${tag}>${children}</${tag}>`;
  }

  return children;
}

export function renderTelegramMessageHtml(input: string | null | undefined): string {
  if (!input) return '';

  if (typeof window === 'undefined') {
    return escapeHtml(input);
  }

  const doc = new DOMParser().parseFromString(input, 'text/html');
  return Array.from(doc.body.childNodes).map(sanitizeNode).join('');
}
