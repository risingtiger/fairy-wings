/** fetch() that throws on HTTP errors. */
export async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response;
}

export const fetchJson = async <T>(url: string): Promise<T> => (await fetchOk(url)).json() as Promise<T>;

/** Resolves `file` against the URL of the manifest that lists it. */
export const besides = (manifestUrl: string, file: string) => new URL(file, new URL(manifestUrl, location.href)).href;
