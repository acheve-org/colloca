/** Helpers for the catalog import: links found on an index page, and sending a long selection in batches. */
export interface Link {
  url: string;
  text: string;
  same_host: boolean;
}

export interface Discovery {
  url: string;
  title: string;
  links: Link[];
  truncated: boolean;
  max_per_request: number;
}

/** Links whose address or text contains `query` (case-insensitive), optionally only those on the page's own host. */
export function filterLinks(links: Link[], query: string, sameHostOnly: boolean): Link[] {
  const q = query.trim().toLowerCase();
  return links.filter(
    (l) => (!sameHostOnly || l.same_host) && (!q || l.url.toLowerCase().includes(q) || l.text.toLowerCase().includes(q)),
  );
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}
