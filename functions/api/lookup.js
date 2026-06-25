// ============================================================
//  Cloudflare Pages Function — /api/lookup
//  "Learn Your Words" 字典 app 的查词中转。
//  你的 Anthropic API key 以 SECRET 环境变量 ANTHROPIC_KEY 存在
//  Cloudflare 服务器端，永远不会出现在网页里，public 看不到。
//
//  这个文件路径决定了访问地址：
//    functions/api/lookup.js   →   https://你的站点/api/lookup
//  app 同源调用它，所以不需要处理跨域。
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

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
