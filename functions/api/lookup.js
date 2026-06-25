// ============================================================
//  Cloudflare Pages Function — /api/lookup
//  "Learn Your Words" 字典 app 的查词中转。
//
//  你的 Anthropic API key 以 SECRET 环境变量 ANTHROPIC_KEY 存在
//  Cloudflare 服务器端，永远不会出现在网页里，偷不走。
//
//  这里额外加了「来源校验」：只接受来自你自己网站的请求，
//  挡掉别的网站/页面直接调用你的接口蹭额度。
//
//  路径决定访问地址：
//    functions/api/lookup.js   →   https://你的站点/api/lookup
// ============================================================

// 允许调用这个接口的网址。部署后把你的真实网址加进来。
// （Cloudflare Pages 默认给的是 https://<项目名>.pages.dev）
const ALLOWED_HOSTS = [
  'learn-your-words.pages.dev',   // ← 改成/补上你的真实 pages.dev 网址
  // 'dictionary.example.com',    // ← 如果以后绑了自定义域名，加在这里
  'localhost',
  '127.0.0.1'
];

function hostAllowed(value) {
  if (!value) return false;
  try {
    const h = new URL(value).hostname;
    return ALLOWED_HOSTS.some(a => h === a || h.endsWith('.' + a));
  } catch (e) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // --- 来源校验：Origin 或 Referer 必须是自己的网站 ---
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  if (!hostAllowed(origin) && !hostAllowed(referer)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad json' }, 400);
  }

  const prompt = body && body.prompt ? String(body.prompt).slice(0, 2000) : '';
  if (!prompt) return json({ error: 'no prompt' }, 400);

  if (!env.ANTHROPIC_KEY) return json({ error: 'server missing key' }, 500);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_KEY,        // ← Cloudflare 的 SECRET，不在网页里
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    const text =
      (data && data.content && data.content[0] && data.content[0].text) || '';
    return json({ text });
  } catch (e) {
    return json({ error: 'upstream error' }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
