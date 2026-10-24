import { isIP } from 'node:net';
import { prepareWAMessageMedia } from './messages.js';
import { extractImageThumb, getHttpStream } from './messages-media.js';

const THUMBNAIL_WIDTH_PX = 192;
const MAX_HTML_BYTES = 768 * 1024;

const getCompressedJpegThumbnail = async (url, { thumbnailWidth, fetchOpts }) => {
    const stream = await getHttpStream(url, fetchOpts);
    const result = await extractImageThumb(stream, thumbnailWidth);
    return result;
};

function isPrivateHost(hostname = '') {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    const kind = isIP(host);
    if (kind === 4) {
        const parts = host.split('.').map(Number);
        return parts[0] === 10 || parts[0] === 127 ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            parts[0] === 0;
    }
    if (kind === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
    return false;
}

function safeUrl(value, base = undefined) {
    try {
        const url = new URL(value, base);
        if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname)) return null;
        return url;
    }
    catch { return null; }
}

function decodeEntities(value = '') {
    return String(value)
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16) || 32))
        .replace(/\s+/g, ' ')
        .trim();
}

function attributes(tag = '') {
    const output = {};
    const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = regex.exec(tag))) output[String(match[1]).toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    return output;
}

function parsePreview(html = '', pageUrl) {
    const meta = new Map();
    for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = attributes(match[0]);
        const key = String(attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
        if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
    }
    const titleTag = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const canonicalTag = [...String(html).matchAll(/<link\b[^>]*>/gi)]
        .map(match => attributes(match[0]))
        .find(attrs => String(attrs.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
    const title = decodeEntities(meta.get('og:title') || meta.get('twitter:title') || titleTag).slice(0, 300);
    if (!title) return null;
    const description = decodeEntities(meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || '').slice(0, 1000);
    const canonical = safeUrl(canonicalTag?.href || meta.get('og:url') || pageUrl.href, pageUrl)?.href || pageUrl.href;
    const image = safeUrl(meta.get('og:image:secure_url') || meta.get('og:image') || meta.get('twitter:image') || '', pageUrl)?.href || '';
    return { url: canonical, title, description, image };
}

async function fetchHtml(startUrl, fetchOpts = {}) {
    let current = safeUrl(startUrl);
    if (!current) return null;
    const timeout = Math.max(1000, Math.min(10000, Number(fetchOpts.timeout) || 3000));
    for (let redirects = 0; redirects <= 5; redirects += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        timer.unref?.();
        let response;
        try {
            response = await fetch(current, {
                method: 'GET',
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    'user-agent': 'Mozilla/5.0 Sakura-MD/1.0.3',
                    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
                    ...(fetchOpts.headers || {})
                }
            });
        }
        finally { clearTimeout(timer); }
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            const next = safeUrl(response.headers.get('location'), current);
            if (!next) return null;
            current = next;
            continue;
        }
        if (!response.ok) return null;
        const type = String(response.headers.get('content-type') || '').toLowerCase();
        if (type && !type.includes('text/html') && !type.includes('application/xhtml')) return null;
        const length = Number(response.headers.get('content-length') || 0);
        if (length > MAX_HTML_BYTES) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_HTML_BYTES) return null;
        return { html: buffer.toString('utf8'), url: current };
    }
    return null;
}

export const getUrlInfo = async (text, opts = {
    thumbnailWidth: THUMBNAIL_WIDTH_PX,
    fetchOpts: { timeout: 3000 }
}) => {
    try {
        const matched = String(text || '').match(/https?:\/\/[^\s<>()]+/i)?.[0] || String(text || '').trim();
        const previewLink = /^https?:\/\//i.test(matched) ? matched : `https://${matched}`;
        const fetched = await fetchHtml(previewLink, opts.fetchOpts || {});
        if (!fetched) return undefined;
        const info = parsePreview(fetched.html, fetched.url);
        if (!info) return undefined;
        const urlInfo = {
            'canonical-url': info.url,
            'matched-text': matched,
            title: info.title,
            description: info.description,
            originalThumbnailUrl: info.image || undefined
        };
        if (info.image && opts.uploadImage) {
            const { imageMessage } = await prepareWAMessageMedia({ image: { url: info.image } }, {
                upload: opts.uploadImage,
                mediaTypeOverride: 'thumbnail-link',
                options: opts.fetchOpts
            });
            urlInfo.jpegThumbnail = imageMessage?.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined;
            urlInfo.highQualityThumbnail = imageMessage || undefined;
        }
        else if (info.image) {
            try { urlInfo.jpegThumbnail = (await getCompressedJpegThumbnail(info.image, opts)).buffer; }
            catch (error) { opts.logger?.debug({ err: error?.stack || String(error), url: previewLink }, 'error in generating thumbnail'); }
        }
        return urlInfo;
    }
    catch (error) {
        opts.logger?.debug?.({ err: error?.stack || String(error) }, 'link preview unavailable');
        return undefined;
    }
};
//# sourceMappingURL=link-preview.js.map
