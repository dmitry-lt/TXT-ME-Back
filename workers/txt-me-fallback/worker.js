export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const awsHost = "326ltbm205.execute-api.eu-north-1.amazonaws.com";

    // 1. Предварительный ответ для Safari (CORS)
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
      // --- 2. ОБРАБОТКА API (api.txt-me.club) ---
      if (url.hostname.startsWith("api.")) {
        const newUrl = `https://${awsHost}${url.pathname}${url.search}`;
        const newHeaders = new Headers(request.headers);

        // Твоя изощренная очистка (фикс 403 Forbidden для маководов)
        newHeaders.set("Host", awsHost);
        newHeaders.delete("x-real-ip");
        newHeaders.delete("cf-connecting-ip");
        newHeaders.delete("x-forwarded-proto");
        newHeaders.delete("x-forwarded-for");
        newHeaders.set("Accept", "application/json, text/plain, */*");
        newHeaders.set("Referer", `https://${awsHost}/`);

        const apiRequest = new Request(newUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
          redirect: 'follow'
        });

        const response = await fetch(apiRequest);
        const resHeaders = new Headers(response.headers);

        resHeaders.set("Access-Control-Allow-Origin", origin || "*");
        resHeaders.set("Access-Control-Allow-Credentials", "true");

        // Очистка заголовков безопасности, которые душат Safari
        resHeaders.delete("Content-Security-Policy");
        resHeaders.delete("X-Frame-Options");
        resHeaders.delete("X-Content-Type-Options");

        return new Response(response.body, { status: response.status, headers: resHeaders });
      }

      // --- 3. ОБРАБОТКА ФРОНТЕНДА (S3) ---
      const isStatic = /\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff2?)$/.test(url.pathname);

      let finalResponse;
      if (isStatic) {
        // Запрос за конкретным файлом (скрипты, стили)
        finalResponse = await fetch(request);
      } else {
        // Прямая ссылка на пост или главная -> отдаем index.html
        // Это заставляет React подхватить роут без ошибки 404 от S3
        finalResponse = await fetch(new URL("/index.html", url.origin));
      }

      // Подготовка заголовков фронтенда
      const frontendHeaders = new Headers(finalResponse.headers);
      frontendHeaders.set("Access-Control-Allow-Origin", origin || "*");

      // Гарантируем правильный MIME-тип для HTML (защита от белого экрана в Safari)
      if (!isStatic) {
        frontendHeaders.set("Content-Type", "text/html; charset=utf-8");
      }

      // Удаляем заголовки, из-за которых Safari может блокировать JS
      frontendHeaders.delete("Content-Security-Policy");
      frontendHeaders.delete("X-Frame-Options");
      frontendHeaders.delete("X-Content-Type-Options");

      return new Response(finalResponse.body, {
        status: finalResponse.status,
        headers: frontendHeaders
      });

    } catch (err) {
      // Глобальный предохранитель, чтобы не было пустого экрана при сбое воркера
      return new Response(JSON.stringify({ error: "Worker Error", details: err.message }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};
