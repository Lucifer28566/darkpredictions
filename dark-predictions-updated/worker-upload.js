// Dark Predictions — Media Upload Worker (streaming, R2)
// Binding required: MEDIA_BUCKET (R2 bucket)
// POST /  body = raw file bytes
//   headers: x-filename (required), content-type (required)
// GET /<key>     → serves the file (public CDN)
// DELETE /<key>  → removes the file from R2

const ALLOWED_ORIGINS = [
  'https://darkpredictions.com',
  'https://www.darkpredictions.com',
  'https://dark-predictions.pages.dev',
];

const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB hard cap — enough for a 10-minute video in good quality

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-filename',
    'Access-Control-Expose-Headers': 'etag',
  };
}

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-150);
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...(headers || {}), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method === 'GET') {
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!key) return json({ error: 'Not found' }, 404, headers);
      const obj = await env.MEDIA_BUCKET.get(key);
      if (!obj) return new Response('Not found', { status: 404, headers });
      const respHeaders = new Headers(headers);
      obj.writeHttpMetadata(respHeaders);
      respHeaders.set('etag', obj.httpEtag);
      respHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(obj.body, { headers: respHeaders });
    }

    if (request.method === 'DELETE') {
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!key) return json({ error: 'No key provided' }, 400, headers);
      await env.MEDIA_BUCKET.delete(key);
      return json({ deleted: key }, 200, headers);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, headers);
    }

    try {
      const filenameRaw = request.headers.get('x-filename');
      let filename = null;
      if (filenameRaw) {
        try { filename = decodeURIComponent(filenameRaw); } catch (e) { filename = filenameRaw; }
      }
      const contentType = request.headers.get('content-type') || 'application/octet-stream';
      const contentLength = parseInt(request.headers.get('content-length') || '0', 10);

      if (!filename) return json({ error: 'Missing x-filename header.' }, 400, headers);
      if (!request.body) return json({ error: 'No file body.' }, 400, headers);
      if (contentLength > MAX_SIZE) {
        return json({ error: 'File too large (max 2GB).' }, 413, headers);
      }

      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFileName(filename)}`;

      await env.MEDIA_BUCKET.put(key, request.body, {
        httpMetadata: { contentType },
      });

      const publicUrl = `${url.origin}/${key}`;
      return json({ url: publicUrl, key, size: contentLength }, 200, headers);
    } catch (err) {
      return json({ error: 'Upload failed: ' + (err && err.message ? err.message : String(err)) }, 500, headers);
    }
  },
};
