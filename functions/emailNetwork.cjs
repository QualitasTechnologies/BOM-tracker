// Bound both receipt of headers and consumption of JSON. A headers-only timeout
// leaves a slow response body able to consume the entire scheduled invocation.
async function fetchJsonResponse(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Email provider request timed out'), {code: 'email_request_timeout', status: 504}));
    }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      const response = await fetchImpl(url, {...options, signal});
      const payload = response.ok ? await response.json() : null;
      return {ok: response.ok, status: response.status, json: async () => payload};
    })()]);
  } finally {
    clearTimeout(timer);
  }
}
module.exports = {fetchJsonResponse};
