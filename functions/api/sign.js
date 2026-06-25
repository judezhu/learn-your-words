// ============================================================
//  Cloudflare Pages Function — /api/sign?word=cat
//  服务器端抓取 signasl.org 的整词手语视频地址，回传给 app 直接播放。
//  （浏览器端有跨域限制读不了，服务器端没有，所以放这里。）
// ============================================================

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  let word = (url.searchParams.get('word') || '').toLowerCase();
  word = word.replace(/[^a-z0-9 \-]/g, '').trim().replace(/\s+/g, '-');
  if (!word) return json({ error: 'no word' }, 400);

  const page = 'https://www.signasl.org/sign/' + encodeURIComponent(word);
  try {
    const r = await fetch(page, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LearnYourWords/1.0)' }
    });
    const html = await r.text();

    // 1) 直接的视频文件 (mp4 / webm)
    const media = [...html.matchAll(/https?:\/\/[^"'\s<>]+?\.(?:mp4|webm)/gi)].map(m => m[0]);
    // 2) og:video meta
    const og = html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i);
    if (og && og[1]) media.unshift(og[1]);
    // 3) 可嵌入的播放器 iframe (youtube / startasl / 等)
    const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
      .map(m => m[1])
      .filter(s => /youtube|youtu\.be|startasl|player|vimeo|video/i.test(s))
      .map(s => s.startsWith('//') ? ('https:' + s) : s);

    const videos = [...new Set(media)].filter(Boolean).slice(0, 6);
    return json({
      word,
      video: videos[0] || null,
      videos,
      embed: iframes[0] || null,
      page
    });
  } catch (e) {
    return json({ error: 'fetch failed', page }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}
