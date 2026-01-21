export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const awsHost = "326ltbm205.execute-api.eu-north-1.amazonaws.com";

    // 1. Предварительный ответ для Safari (CORS preflight)
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

    try {
      // 2. Формируем новый URL для AWS
      const newUrl = `https://${awsHost}${url.pathname}${url.search}`;

      // Копируем все заголовки оригинального запроса
      const newHeaders = new Headers(request.headers);

      // ПРИНУДИТЕЛЬНО подменяем Host и очищаем "следы" прокси
      newHeaders.set("Host", awsHost);
      newHeaders.delete("x-real-ip");
      newHeaders.delete("cf-connecting-ip");
      newHeaders.delete("x-forwarded-proto");
      newHeaders.delete("x-forwarded-for");

      // Safari часто шлет сложные Accept-заголовки, упрощаем их для AWS
      newHeaders.set("Accept", "application/json, text/plain, */*");
      // Убираем Referer, чтобы AWS не смущал переход с домена на домен
      newHeaders.set("Referer", `https://${awsHost}/`);

      // 3. Создаем модифицированный запрос к AWS
      const modifiedRequest = new Request(newUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
        redirect: 'follow'
      });

      const response = await fetch(modifiedRequest);

      // 4. Подготавливаем ответ для браузера (Изощренная очистка)
      const responseHeaders = new Headers(response.headers);

      responseHeaders.set("Access-Control-Allow-Origin", origin || "*");
      responseHeaders.set("Access-Control-Allow-Credentials", "true");

      // Удаляем заголовки, которые заставляют Safari блокировать контент
      responseHeaders.delete("Content-Security-Policy");
      responseHeaders.delete("X-Frame-Options");
      responseHeaders.delete("X-Content-Type-Options");
      responseHeaders.delete("X-XSS-Protection");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (err) {
      console.error("Worker Error:", err.message);

      return new Response(JSON.stringify({
        error: "Worker Gateway Error",
        message: err.message
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin || "*"
        }
      });
    }
  }
};
