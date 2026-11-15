export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) {
      const key = part.slice(0, i).trim();
      if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return out;
}

export function readBody(req, limit = 100_000) {
  return new Promise((resolve) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    const done = () => resolve({ body: Buffer.concat(chunks).toString('utf8'), tooLarge });
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', done);
    req.on('close', done);
    req.on('error', done);
  });
}

export function formFields(body) {
  const out = {};
  for (const [key, value] of new URLSearchParams(body)) out[key] = value;
  return out;
}

export function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

export function redirect(res, location) {
  res.writeHead(303, { Location: location, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Redirect: ${location}`);
}
