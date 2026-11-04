// updateQuery changes the query string through the History API: Next keeps
// useSearchParams in sync with it and does not reload the route.
export function updateQuery(change: (current: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) {
  const query = change(new URLSearchParams(window.location.search)).toString();
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  if (options?.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}
