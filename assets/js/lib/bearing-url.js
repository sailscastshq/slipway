// Preserve the embedded renderer and initial mode on full-document navigation.
export function bearingUrl(path, embedded, appearance) {
  if (!embedded) return path
  const url = new URL(path, 'https://bearing.invalid')
  url.searchParams.set('embedded', '1')
  const mode =
    typeof document === 'undefined'
      ? appearance?.resolvedMode
      : document.documentElement.dataset.appearanceMode ||
        appearance?.resolvedMode
  if (appearance?.mode === 'host' && ['light', 'dark'].includes(mode))
    url.searchParams.set('appearanceMode', mode)
  return url.pathname + url.search + url.hash
}
