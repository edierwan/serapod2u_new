import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

// Note: short_links and short_link_clicks tables are accessed here. TypeScript types will be generated after migration.

// Hash IP for privacy
function hashIP(ip: string | null): string | null {
    if (!ip) return null;
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

// Merge UTM parameters
function mergeUTMParams(baseUrl: string, defaultUtm: Record<string, string> | null, queryParams: URLSearchParams): string {
    const url = new URL(baseUrl);

    // First, add default UTM params
    if (defaultUtm) {
        for (const [key, value] of Object.entries(defaultUtm)) {
            if (!url.searchParams.has(key)) {
                url.searchParams.set(key, value);
            }
        }
    }

    // Then, add/override with query params from request
    queryParams.forEach((value, key) => {
        if (key !== 'slug') { // Don't include slug itself
            url.searchParams.set(key, value);
        }
    });

    return url.toString();
}

// GET: Public redirect endpoint
export async function GET(
    request: Request,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);

    // Use service role for logging clicks (bypasses RLS)
    const supabase = await createClient() as any; // Cast to any until types are regenerated

    // Look up short link
    const { data: shortLink, error } = await supabase
        .from('short_links')
        .select('id, slug, is_active, default_utm')
        .eq('slug', slug)
        .single();

    if (error || !shortLink) {
        return new NextResponse(
            `<!DOCTYPE html>
      <html>
        <head>
          <title>Link Not Found</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; margin-bottom: 8px; }
            p { color: #666; margin-bottom: 24px; }
            a { color: #2563eb; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Link Not Found</h1>
            <p>This link is invalid or has expired.</p>
            <a href="/">Return to Home</a>
          </div>
        </body>
      </html>`,
            {
                status: 404,
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }

    if (!shortLink.is_active) {
        return new NextResponse(
            `<!DOCTYPE html>
      <html>
        <head>
          <title>Link Expired</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; margin-bottom: 8px; }
            p { color: #666; margin-bottom: 24px; }
            a { color: #2563eb; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Link Expired</h1>
            <p>This promotional link is no longer active.</p>
            <a href="/">Return to Home</a>
          </div>
        </body>
      </html>`,
            {
                status: 410,
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }

    // Build final URL with UTM params
    const appDestination = `${process.env.NEXT_PUBLIC_APP_URL}/app`;
    const finalUrl = mergeUTMParams(
        appDestination,
        shortLink.default_utm as Record<string, string> | null,
        searchParams
    );

    // Log click (non-blocking)
    const userAgent = request.headers.get('user-agent');
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : null;
    const campaignId = searchParams.get('campaign_id') || null;

    // Fire and forget - don't wait for insert
    (async () => {
        try {
            await supabase
                .from('short_link_clicks')
                .insert({
                    short_link_id: shortLink.id,
                    user_agent: userAgent,
                    ip_hash: hashIP(ip),
                    ref_campaign_id: campaignId && /^[0-9a-f-]{36}$/i.test(campaignId) ? campaignId : null,
                    meta: {
                        referrer: request.headers.get('referer'),
                        accept_language: request.headers.get('accept-language')
                    }
                });
        } catch (err) {
            console.error('Click logging error:', err);
        }
    })();

    // Redirect to destination
    return NextResponse.redirect(finalUrl, 302);
}
