import {bindings, json} from './server';

export function allowedOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return false;
  if (origin === new URL(request.url).origin) return true;
  const frontend = String(bindings().FRONTEND_URL || '');
  try { return !!frontend && origin === new URL(frontend).origin; }
  catch { return false; }
}

// Cookie credentials may be read only by this deployment's exact frontend origin.
// Apply to every response, including images and errors; never use a wildcard.
export function withCors<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    const origin = request.headers.get('Origin');
    if ((origin || request.method === 'OPTIONS') && !allowedOrigin(request)) {
      return json({error: '请求来源校验失败'}, 403);
    }
    let response: Response;
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('Access-Control-Request-Method') || '';
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return json({error: '请求方式不支持'}, 405);
      response = new Response(null, {status: 204, headers: {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      }});
    } else response = await handler(request, context);
    if (!origin) return response;
    // Preserve multiple Set-Cookie headers and streaming image response bodies.
    const result = new Response(response.body, response);
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Access-Control-Allow-Credentials', 'true');
    result.headers.append('Vary', 'Origin');
    return result;
  };
}
