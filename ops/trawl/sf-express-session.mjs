import { spawn } from 'node:child_process';
import { detectSfExpressGap } from './sf-express-gap.mjs';

const ORIGIN = 'https://htm.sf-express.com';
const PAGE = '/tw/en/dynamic_function/waybill/';
const ROUTES = '/sf-service-core-web/service/bills/';
const MAX_RESPONSE = 2_000_000;
const MAX_PNG = 262_144;

export function sfExpressSessionNumber(url, capture = {}) {
  let page;
  try { page = new URL(url); } catch { return null; }
  const number = /^#search\/bill-number\/(\d{12}|SF\d{13})$/.exec(page.hash)?.[1];
  if (page.origin !== ORIGIN || page.pathname !== PAGE || page.search || page.username || page.password
    || !number || capture.captureResponses?.length !== 1
    || capture.captureResponses[0] !== `${ORIGIN}${ROUTES}${number}/routes`) return null;
  return number;
}

export function sfExpressImageUrl(value, kind) {
  let url;
  try { url = new URL(value); } catch { return null; }
  return url.origin === 'https://static.geetest.com' && !url.username && !url.password && !url.search && !url.hash
    && new RegExp(`^/pictures/v4_pic/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/${kind}/[a-f0-9]{32}\\.png$`).test(url.pathname)
    ? url.href : null;
}

export function sfExpressPngSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > MAX_PNG
    || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || Buffer.from(bytes.subarray(12, 16)).toString() !== 'IHDR') throw new Error('Invalid challenge image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 512 || height > 512) throw new Error('Challenge image dimensions changed');
  return { width, height };
}

export async function decodeSfExpressPng(bytes, signal) {
  signal.throwIfAborted();
  const { width, height } = sfExpressPngSize(bytes);
  const expected = width * height * 4;
  return new Promise((resolve, reject) => {
    const decoder = spawn(process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
      ['-v', 'error', '-threads', '1', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL' });
    let size = 0, failed = false;
    const chunks = [];
    const fail = () => { if (!failed) { failed = true; decoder.kill('SIGKILL'); reject(new Error('Challenge image decoding failed')); } };
    decoder.on('error', fail);
    decoder.stdin.on('error', fail);
    decoder.stderr.on('data', () => {});
    decoder.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > expected) fail();
      else if (!failed) chunks.push(chunk);
    });
    decoder.on('close', code => {
      if (failed) return;
      if (code !== 0 || size !== expected || signal.aborted) return fail();
      resolve({ data: Buffer.concat(chunks, size), width, height });
    });
    decoder.stdin.end(bytes);
  });
}

async function readImage(url, signal) {
  signal.throwIfAborted();
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit' });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('image/png')
    || !Number.isSafeInteger(length) || length < 0 || length > MAX_PNG) {
    await response.body?.cancel();
    throw new Error('Challenge image is unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PNG) { await reader.cancel(); throw new Error('Challenge image is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

// Read only visible, settled widget geometry. CSS dimensions differ from the
// rendered rectangle during GeeTest's entrance animation.
export function sfExpressWidget() {
  const visible = selector => [...document.querySelectorAll(selector)].filter(element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  const boxes = visible('.geetest_box');
  if (boxes.length !== 1) return null;
  const result = {};
  for (const [name, selector] of [['background', '.geetest_bg'], ['piece', '.geetest_slice_bg'],
    ['slice', '.geetest_slice'], ['handle', '.geetest_btn']]) {
    const elements = visible(selector).filter(element => boxes[0].contains(element));
    if (elements.length !== 1) return null;
    const element = elements[0], rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    result[name] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      cssWidth: Number.parseFloat(style.width), borderLeft: Number.parseFloat(style.borderLeftWidth) || 0,
      borderTop: Number.parseFloat(style.borderTopWidth) || 0,
      image: /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage)?.[1] ?? null };
  }
  const { handle } = result;
  const hit = document.elementFromPoint(handle.x + handle.width / 2, handle.y + handle.height / 2);
  result.handleReady = Boolean(hit?.closest('.geetest_btn') && boxes[0].contains(hit));
  return result;
}

export function sfExpressDragPlan(widget, background, match) {
  const { background: bg, slice, handle } = widget;
  const parentScale = bg.width / (bg.cssWidth + 2 * bg.borderLeft);
  const scale = parentScale * bg.cssWidth / background.width;
  const x = bg.x + parentScale * bg.borderLeft + match.x * scale;
  const distance = x - slice.x;
  if (!match.accepted || !widget.handleReady || ![scale, distance, x].every(Number.isFinite)
    || scale < 0.25 || scale > 4 || distance < 20 || distance > bg.width - slice.width + 3) {
    throw new Error('Challenge geometry changed');
  }
  return { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, distance, target: x };
}

function sameWidget(a, b) {
  if (!a || !b || !b.handleReady) return false;
  return ['background', 'slice', 'handle'].every(name => ['x','y','width','height'].every(key =>
    Math.abs(a[name][key] - b[name][key]) < 0.15))
    && a.background.image === b.background.image && a.piece.image === b.piece.image;
}

function routeRequest(request, number) {
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (request.method() !== 'GET' || url.origin !== ORIGIN || url.pathname !== `${ROUTES}${number}/routes`) return false;
  const allowed = new Map([['lang','en'], ['region','tw'], ['translate',''], ['app','bill']]);
  return [...url.searchParams].every(([key, value]) => allowed.get(key) === value)
    && [...allowed].every(([key, value]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value);
}

function abortable(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(new Error('SF Express lookup stopped')); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('SF Express lookup stopped'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class SfExpressSessions {
  #busy = new WeakSet();
  constructor({ closeMs = 2_000, fetchImage = readImage, decodeImage = decodeSfExpressPng, solve = null } = {}) {
    this.closeMs = closeMs;
    this.fetchImage = fetchImage;
    this.decodeImage = decodeImage;
    this.solve = solve;
  }

  async run({ url, handle, tier, maxTimeout, capture, installPolicy, signal }) {
    const number = sfExpressSessionNumber(url, capture);
    if (!number) return undefined;
    const started = Date.now(), browser = handle.browser;
    const failure = reason => ({ tier, status: 'error', reason, durationMs: Date.now() - started });
    if (!Number.isFinite(maxTimeout) || maxTimeout < 1 || signal?.aborted) return failure('SF Express lookup budget exhausted');
    if (this.#busy.has(browser)) return failure('SF Express browser is busy');
    this.#busy.add(browser);
    const budget = Math.min(maxTimeout, 60_000), deadline = started + budget;
    const reserve = Math.min(this.closeMs, Math.floor(budget / 5));
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(0, budget - reserve));
    let context, closing, disposed = false;
    const close = async () => {
      disposed = true;
      if (!context) return;
      if (!closing) closing = Promise.resolve().then(() => context.close());
      let closeTimer, completed = false;
      try {
        await Promise.race([Promise.resolve(closing).then(() => { completed = true; }), new Promise(resolve => {
          closeTimer = setTimeout(resolve, Math.max(0, Math.min(this.closeMs, deadline - Date.now())));
        })]);
      } catch {} finally {
        clearTimeout(closeTimer);
        if (!completed) handle.requestBrowserReplacement?.('SF Express context cleanup did not finish');
      }
    };
    let abortReject;
    const aborted = new Promise((_, reject) => { abortReject = () => { void close(); reject(new Error('SF Express lookup stopped')); }; });
    controller.signal.addEventListener('abort', abortReject, { once: true });
    const remaining = () => { controller.signal.throwIfAborted(); return Math.max(1, deadline - reserve - Date.now()); };
    const work = async () => {
      context = await browser.newContext({ viewport: null });
      handle.noteTemporaryContext?.();
      if (disposed || controller.signal.aborted) { await close(); throw new Error('SF Express setup ended late'); }
      const page = await abortable(context.newPage(), controller.signal);
      await abortable(installPolicy?.(page), controller.signal);
      controller.signal.throwIfAborted();
      const result = await this.#lookup({ page, url, number, signal: controller.signal, remaining });
      return { tier, status: 'success', statusCode: 200, effectiveUrl: url, durationMs: Date.now() - started,
        cookies: [], ...result };
    };
    try { return await Promise.race([work(), aborted]); }
    catch { return failure('SF Express browser could not complete tracking'); }
    finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', abortReject);
      await close();
      if (!context) handle.requestBrowserReplacement?.('SF Express context setup did not finish');
      this.#busy.delete(browser);
    }
  }

  async #lookup({ page, url, number, signal, remaining }) {
    const requests = new Set();
    let resolveReply, accepting = true;
    const reply = new Promise(resolve => { resolveReply = resolve; });
    const onRequest = request => { if (accepting && routeRequest(request, number)) requests.add(request); };
    const onResponse = response => { if (accepting && requests.has(response.request())) resolveReply(response); };
    const onFailure = request => { if (requests.has(request)) resolveReply(null); };
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onFailure);
    try {
      const navigation = await abortable(page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(20_000, remaining()) }), signal);
      if (!requests.size) {
        const solverController = new AbortController();
        const stopSolver = () => solverController.abort();
        signal.addEventListener('abort', stopSolver, { once: true });
        try {
          // A cached or automatically accepted challenge can answer after
          // navigation, without ever displaying a widget. Stop only the solver;
          // the main signal still permits reading its exact tracking response.
          const solving = this.solve
            ? abortable(this.solve(page, { signal: solverController.signal, remaining }), solverController.signal)
            : this.#solve(page, solverController.signal, remaining);
          await abortable(Promise.race([reply, solving]), signal);
        } finally {
          stopSolver();
          signal.removeEventListener('abort', stopSolver);
        }
      }
      const response = await abortable(reply, signal);
      signal.throwIfAborted();
      if (!response) throw new Error('SF Express route request failed');
      const headers = response.headers();
      const length = Number(headers['content-length'] ?? 0);
      if (!String(headers['content-type'] ?? '').includes('application/json') || !Number.isSafeInteger(length)
        || length < 0 || length > MAX_RESPONSE) throw new Error('SF Express route response changed');
      const bytes = await abortable(response.body(), signal);
      signal.throwIfAborted();
      if (bytes.length > MAX_RESPONSE) throw new Error('SF Express route response is too large');
      const body = bytes.toString('utf8');
      const data = JSON.parse(body);
      // A solved widget is only useful when its own tracking request answers.
      // Preserve provider errors and verified empty replies for the adapter.
      if (!data || typeof data !== 'object' || !Number.isFinite(Number(data.code))) throw new Error('SF Express route schema changed');
      if (Number(data.code) === 0 && Array.isArray(data.result) && data.result.length
        && (data.result.length !== 1 || data.result[0]?.id !== number)) throw new Error('SF Express response identity changed');
      const html = await abortable(page.content(), signal);
      signal.throwIfAborted();
      if (html.length > 500_000) throw new Error('SF Express page is too large');
      return { html, statusCode: navigation?.status(), capturedResponses: [{ url: response.url(), status: response.status(),
        headers: headers['retry-after'] ? { 'retry-after': headers['retry-after'].slice(0, 100) } : {},
        body, base64Encoded: false, truncated: false }] };
    } finally {
      accepting = false;
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onFailure);
    }
  }

  async #solve(page, signal, remaining) {
    const pause = ms => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const done = () => { signal.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, Math.min(ms, remaining()));
      const abort = () => { clearTimeout(timer); reject(new Error('SF Express solve stopped')); };
      signal.addEventListener('abort', abort, { once: true });
    });
    let previous, widget, stable = 0;
    while (remaining() > 0) {
      widget = await abortable(page.evaluate(sfExpressWidget), signal);
      signal.throwIfAborted();
      stable = sameWidget(previous, widget) ? stable + 1 : 0;
      if (stable >= 3) break;
      previous = widget;
      await pause(200);
    }
    if (!widget) throw new Error('SF Express challenge did not load');
    const bgUrl = sfExpressImageUrl(widget.background.image, 'bg');
    const pieceUrl = sfExpressImageUrl(widget.piece.image, 'slide');
    if (!bgUrl || !pieceUrl || bgUrl.replace('/bg/', '/slide/') !== pieceUrl) throw new Error('Challenge images changed');
    const [background, piece] = await abortable(Promise.all([bgUrl, pieceUrl].map(async url =>
      this.decodeImage(await this.fetchImage(url, signal), signal))), signal);
    signal.throwIfAborted();
    if (piece.width > 256 || piece.height > 256) throw new Error('Challenge piece is too large');
    const renderedScale = widget.background.width / background.width;
    const expectedY = Math.round((widget.slice.y - widget.background.y) / renderedScale);
    const match = detectSfExpressGap(background, piece, { expectedY });
    const plan = sfExpressDragPlan(widget, background, match);
    // Recheck after image I/O: a refreshed challenge must never use old geometry.
    const current = await abortable(page.evaluate(sfExpressWidget), signal);
    if (!sameWidget(widget, current)) throw new Error('Challenge changed during image analysis');
    await abortable(page.mouse.move(plan.x, plan.y), signal);
    signal.throwIfAborted();
    await abortable(page.mouse.down(), signal);
    try {
      // Camoufox already supplies natural pointer motion. Large chains of tiny
      // moves multiply its per-call delay and exhaust the tracking deadline.
      await abortable(page.mouse.move(plan.x + plan.distance, plan.y + 0.6), signal);
      await pause(180);
    } finally { if (!signal.aborted) await abortable(page.mouse.up(), signal); }
    signal.throwIfAborted();
  }
}

export const sfExpressSessions = new SfExpressSessions();
