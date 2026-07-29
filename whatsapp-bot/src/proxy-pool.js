import { log } from './logger.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const MAX_FAILS = 2;
const RESET_INTERVAL = 5 * 60 * 1000;

let proxies = [];
let activeIndex = 0;
let failCounts = [];
let resetTimer = null;

function getProxyUrl(index) {
  const p = proxies[index];
  if (!p) return null;
  return p.scheme + '://' + (p.auth ? p.auth + '@' : '') + p.host + ':' + p.port;
}

function parseProxyUrl(url) {
  try {
    const match = url.match(/^(socks5|socks5h|http|https):\/\/(?:(.+?):(.+?)@)?([^:]+):(\d+)$/);
    if (!match) return null;
    const scheme = match[1];
    const user = match[2];
    const pass = match[3];
    const host = match[4];
    const port = match[5];
    const auth = user && pass ? user + ':' + pass : null;
    return { scheme, user, pass, host, port: parseInt(port), auth, url };
  } catch { return null; }
}

function parseProxyList() {
  const listEnv = process.env.BOT_PROXY_LIST;
  const singleEnv = process.env.BOT_PROXY;
  const urls = [];
  if (listEnv) {
    const parts = listEnv.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) urls.push(p);
  }
  if (urls.length === 0 && singleEnv) {
    urls.push(singleEnv);
  }
  return urls;
}

export function initPool() {
  const raw = parseProxyList();
  proxies = [];
  failCounts = [];
  activeIndex = 0;
  for (const u of raw) {
    const parsed = parseProxyUrl(u);
    if (parsed) {
      proxies.push(parsed);
      failCounts.push(0);
      log('PROXY POOL: added ' + parsed.scheme + '://' + (parsed.auth ? parsed.host : '(no auth)'));
    } else {
      log('PROXY POOL: invalid url, skipping: ' + u.replace(/:([^:@]+)@/, ':***@'));
    }
  }
  if (proxies.length > 0) {
    log('PROXY POOL: loaded ' + proxies.length + ' proxies, active 0');
  } else {
    log('PROXY POOL: no proxies configured');
  }
  if (resetTimer) clearInterval(resetTimer);
  resetTimer = setInterval(() => {
    const anyFailed = failCounts.some(c => c > 0);
    if (anyFailed) {
      failCounts.fill(0);
      activeIndex = 0;
      log('PROXY POOL: reset all fail counts');
    }
  }, RESET_INTERVAL);
}

export function getActiveProxy() {
  if (proxies.length === 0) return null;
  return proxies[activeIndex];
}

export function getActiveProxyUrl() {
  const p = getActiveProxy();
  return p ? getProxyUrl(activeIndex) : null;
}

export function createAgent() {
  const p = getActiveProxy();
  if (!p) return undefined;
  try {
    if (p.scheme.startsWith('socks')) {
      return new SocksProxyAgent({
        host: p.host,
        port: p.port,
        protocol: p.scheme + ':',
        userId: p.user,
        password: p.pass,
      });
    }
    const url = getProxyUrl(activeIndex);
    return new HttpsProxyAgent(url);
  } catch (e) {
    log('PROXY POOL: agent error for ' + p.host + ':' + p.port + ': ' + e.message);
    return undefined;
  }
}

export function markFailed(proxyUrl) {
  if (proxies.length === 0) return false;
  const idx = proxies.findIndex((p, i) => getProxyUrl(i) === proxyUrl);
  if (idx === -1) {
    log('PROXY POOL: markFailed unknown proxy ' + (proxyUrl || '').replace(/:([^:@]+)@/, ':***@'));
    return false;
  }
  failCounts[idx]++;
  const failCount = failCounts[idx];
  const proxyLabel = proxies[idx].scheme + '://' + proxies[idx].host + ':' + proxies[idx].port;
  log('PROXY POOL: markFailed ' + proxyLabel + ' failCount=' + failCount + '/' + MAX_FAILS);

  if (failCount >= MAX_FAILS) {
    if (allFailed()) {
      failCounts.fill(0);
      activeIndex = 0;
      log('PROXY POOL: all proxies failed, resetting');
      return true;
    }
    rotate();
    return true;
  }
  return false;
}

export function markHealthy(proxyUrl) {
  if (proxies.length === 0) return;
  const idx = proxies.findIndex((p, i) => getProxyUrl(i) === proxyUrl);
  if (idx === -1) return;
  if (failCounts[idx] > 0) {
    const proxyLabel = proxies[idx].scheme + '://' + proxies[idx].host + ':' + proxies[idx].port;
    log('PROXY POOL: markHealthy ' + proxyLabel);
    failCounts[idx] = 0;
  }
}

function rotate() {
  if (proxies.length <= 1) return;
  const prev = activeIndex;
  activeIndex = (activeIndex + 1) % proxies.length;
  log('PROXY POOL: rotated from index=' + prev + ' to index=' + activeIndex + ' (' + proxies[activeIndex].host + ')');
}

function allFailed() {
  return failCounts.every(c => c >= MAX_FAILS);
}

export function hasProxies() {
  return proxies.length > 0;
}

export function getPoolStatus() {
  return proxies.map((p, i) => ({
    index: i,
    scheme: p.scheme,
    host: p.host,
    port: p.port,
    auth: !!p.auth,
    label: p.scheme + '://' + p.host + ':' + p.port,
    failCount: failCounts[i],
    active: i === activeIndex,
    healthy: failCounts[i] < MAX_FAILS,
  }));
}
