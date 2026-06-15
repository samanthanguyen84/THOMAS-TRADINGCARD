// Small fetch wrapper for the Thomas Trading Card API.
// JSON in / JSON out. Throws an Error carrying the server's `{ error }`
// message (and `.status`) on any non-2xx response.

async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    const err = new Error('Could not reach the server. Is it running?');
    err.status = 0;
    throw err;
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    let message =
      (data && data.error) || `Request failed (${res.status} ${res.statusText})`;
    // A 404 with no JSON body on an API route means the running server doesn't
    // have that endpoint — almost always an out-of-date server that needs a
    // restart after pulling new code.
    if (res.status === 404 && !data && path.startsWith('/api/')) {
      message =
        'That feature isn’t on the running server (404). Your server is likely running older code — stop it (Ctrl+C) and run “npm start” again.';
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body = {}) => request(path, { method: 'POST', body }),
  put: (path, body = {}) => request(path, { method: 'PUT', body }),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

// Build a query string, skipping empty/null/undefined values.
export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
