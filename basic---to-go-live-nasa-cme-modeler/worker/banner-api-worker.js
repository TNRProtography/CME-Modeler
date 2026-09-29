// --- Global Banner API Cloudflare Worker ---
// Uses ES Modules format so bindings are accessed via env parameter

const ALLOWED_ORIGINS = [
  'https://cme-modeler.pages.dev',
  'https://spottheaurora.co.nz',
  'https://banner-control.pages.dev',
  'https://banner-api.thenamesrock.workers.dev'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const baseCorsHeaders = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Cache-Control',
      'Access-Control-Max-Age': '86400',
    };

    const origin = request.headers.get('Origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      baseCorsHeaders['Access-Control-Allow-Origin'] = origin;
    }

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: baseCorsHeaders });
    }

    const isAuthenticated = (req) => {
      const apiKey = req.headers.get('X-API-Key');
      return apiKey && apiKey === env.BANNER_AUTH_TOKEN;
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...baseCorsHeaders },
        status,
      });

    try {
      // ── Public: GET /banner ──────────────────────────────────────────────
      if (path === '/banner' && method === 'GET') {
        const bannerJson = await env.BANNER_DATA.get('current_banner', { type: 'text' });
        const banner = bannerJson ? JSON.parse(bannerJson) : { isActive: false };
        delete banner.authToken;
        return new Response(JSON.stringify(banner), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60, s-maxage=60',
            ...baseCorsHeaders,
          },
          status: 200,
        });
      }

      // ── Admin: /admin/banner ─────────────────────────────────────────────
      if (path === '/admin/banner') {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);

        if (method === 'GET') {
          const bannerJson = await env.BANNER_DATA.get('current_banner', { type: 'text' });
          const banner = bannerJson ? JSON.parse(bannerJson) : { isActive: false };
          return json(banner);
        }

        if (method === 'POST') {
          const cfg = await request.json();
          if (!cfg) return json({ error: 'Empty body' }, 400);
          if (typeof cfg.message !== 'string' || (cfg.message.length < 1 && cfg.isActive))
            return json({ error: 'Message required when active' }, 400);
          if (cfg.message.length > 500) return json({ error: 'Message too long (max 500)' }, 400);
          if (cfg.link && !/^https?:\/\/.+/.test(cfg.link.url))
            return json({ error: 'Invalid link URL' }, 400);

          cfg.isActive = typeof cfg.isActive === 'boolean' ? cfg.isActive : false;
          cfg.type = ['info', 'warning', 'alert', 'custom'].includes(cfg.type) ? cfg.type : 'info';
          cfg.dismissible = typeof cfg.dismissible === 'boolean' ? cfg.dismissible : true;
          cfg.backgroundColor = cfg.type === 'custom' && typeof cfg.backgroundColor === 'string' ? cfg.backgroundColor : undefined;
          cfg.textColor = cfg.type === 'custom' && typeof cfg.textColor === 'string' ? cfg.textColor : undefined;
          cfg.emojis = typeof cfg.emojis === 'string' ? cfg.emojis.trim() : undefined;
          cfg.link = cfg.link?.url && cfg.link?.text ? cfg.link : undefined;
          cfg.id = `banner-${Date.now()}`;

          await env.BANNER_DATA.put('current_banner', JSON.stringify(cfg));
          return json({ success: true, message: 'Banner updated.', banner: cfg });
        }

        if (method === 'DELETE') {
          const existing = await env.BANNER_DATA.get('current_banner', { type: 'text' });
          const banner = existing ? { ...JSON.parse(existing), isActive: false } : { isActive: false };
          await env.BANNER_DATA.put('current_banner', JSON.stringify(banner));
          return json({ success: true, message: 'Banner deactivated.' });
        }

        return json({ error: 'Method not allowed' }, 405);
      }

      // ── Admin: POST /admin/send-broadcast ────────────────────────────────
      if (path === '/admin/send-broadcast' && method === 'POST') {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);

        const { title, body, url: targetUrl, setBanner, bannerType } = await request.json();
        if (!title || !body) return json({ error: 'title and body are required' }, 400);

        const pushWorkerUrl = env.PUSH_WORKER_URL || 'https://push-notification-worker.thenamesrock.workers.dev';
        // Use BANNER_AUTH_TOKEN as the push secret — same value added to push worker
        const pushSecret = env.BANNER_AUTH_TOKEN;
        console.log('[send-broadcast] pushSecret set:', !!pushSecret, 'pushWorkerUrl:', pushWorkerUrl);

        if (!pushSecret) return json({ error: 'BANNER_AUTH_TOKEN not configured' }, 500);

        // Send push notification
        let pushResult = { success: false, error: 'Not attempted' };
        try {
          console.log('[send-broadcast] calling push worker...');
          const pushResp = await fetch(`${pushWorkerUrl}/send-broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: pushSecret, title, body, url: targetUrl || '/' }),
          });
          console.log('[send-broadcast] push worker response status:', pushResp.status);
          pushResult = await pushResp.json();
          console.log('[send-broadcast] push result:', JSON.stringify(pushResult));
        } catch (e) {
          console.error('[send-broadcast] fetch error:', e.message);
          pushResult = { success: false, error: e.message };
        }

        // Optionally set the site banner
        let bannerResult = null;
        if (setBanner) {
          const bannerCfg = {
            isActive: true,
            message: body,
            type: bannerType || 'info',
            emojis: '📡',
            id: `broadcast-${Date.now()}`,
            link: targetUrl ? { url: targetUrl, text: 'View forecast' } : undefined,
          };
          await env.BANNER_DATA.put('current_banner', JSON.stringify(bannerCfg));
          bannerResult = { set: true };
        }

        return json({ success: pushResult.success, push: pushResult, banner: bannerResult });
      }

      // ── 404 ──────────────────────────────────────────────────────────────
      return json({ error: 'Not found', path }, 404);

    } catch (error) {
      console.error('Worker error:', error);
      return json({ error: 'Internal server error', message: error.message }, 500);
    }
  }
};

