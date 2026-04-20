/**
 * Robust clipboard copy with fallback for non-secure contexts
 * (HTTP, older browsers, or when Permissions-Policy blocks clipboard API).
 *
 * Returns Promise<boolean> — true on success.
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  // Primary: modern Clipboard API (requires secure context + user gesture)
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    // Fall through to legacy path
  }

  // Fallback: hidden textarea + execCommand('copy')
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}
