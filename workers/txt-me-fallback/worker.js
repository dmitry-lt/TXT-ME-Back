export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const awsHost = "326ltbm205.execute-api.eu-north-1.amazonaws.com";

    // 1. Предварительный ответ для Safari (CORS preflight) — ТВОЙ ОРИГИНАЛ
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-id, x-api-key",
          "Access-Control-Allow-Credentials": "true",
          "Cache-Control": "no-cache"
        },
      });
    }

    // --- 2. ОБРАБОТКА API (Проксирование с очисткой заголовков) ---
    if (url.hostname.startsWith("api.")) {
      try {
        const newUrl = `https://${awsHost}${url.pathname}${url.search}`;
        const newHeaders = new Headers(request.headers);

        // Твоя изощренная очистка "следов" прокси (фикс 403 Forbidden)
        newHeaders.set("Host", awsHost);
        newHeaders.delete("x-real-ip");
        newHeaders.delete("cf-connecting-ip");
        newHeaders.delete("x-forwarded-proto");
        newHeaders.delete("x-forwarded-for");

        newHeaders.set("Accept", "application/json, text/plain, */*");
        newHeaders.set("Referer", `https://${awsHost}/`);

        const modifiedRequest = new Request(newUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
          redirect: 'follow'
        });

        const response = await fetch(modifiedRequest);
        const resHeaders = new Headers(response.headers);

        resHeaders.set("Access-Control-Allow-Origin", origin || "*");
        resHeaders.set("Access-Control-Allow-Credentials", "true");

        // Твоя очистка заголовков безопасности для Safari
        resHeaders.delete("Content-Security-Policy");
        resHeaders.delete("X-Frame-Options");
        resHeaders.delete("X-Content-Type-Options");
        resHeaders.delete("X-XSS-Protection");

        return new Response(response.body, { status: response.status, headers: resHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: "API Gateway Error", message: err.message }), { status: 502 });
      }
    }

    // --- 3. ОБРАБОТКА ФРОНТЕНДА (Умные ссылки) ---

    // Пропускаем статические файлы (картинки, JS, CSS) без изменений
    const isStatic = /\.(js|css|png|jpg|jpeg|gif|svg|ico|json)$/.test(url.pathname);
    if (isStatic) {
      return fetch(request);
    }

    // Если это прямая ссылка на пост (например, /posts/123)
    if (url.pathname.startsWith("/posts/") || url.pathname.length > 1) {
      // Запрашиваем index.html напрямую из корня, чтобы React подхватил роут
      // В браузере при этом останется красивая ссылка автора
      const indexUrl = new URL("/index.html", url.origin);
      return fetch(indexUrl);
    }

    // Во всех остальных случаях (главная страница) просто работаем штатно
    return fetch(request);
  }
};
