const $ = (id) => document.getElementById(id);
const descriptions = {
  token_bucket: 'Refills tokens over time; bursts are allowed up to capacity.',
  fixed_window: 'Counts requests inside fixed intervals; boundary bursts are possible.',
  sliding_window: 'Tracks actual requests over the preceding rolling interval.',
  leaky_bucket: 'Usage drains steadily, rejecting excess traffic without queuing.'
};
let config;
let busy = false;
async function readJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function refresh() {
  try {
    const [health, metrics] = await Promise.all([readJson('/api/health'), readJson('/api/metrics')]);
    const chip = $('modeChip');
    const fall = health.redisMode === 'memory-fallback';
    chip.classList.toggle('fallback', fall);
    chip.innerHTML = `<i></i>${fall ? 'Redis offline · fallback' : health.redisMode === 'redis' ? 'Redis connected' : 'Ready to test'}`;
    $('total').textContent = metrics.requests;
    $('allowed').textContent = metrics.allowed;
    $('blocked').textContent = metrics.blocked;
    $('latency').innerHTML = `${metrics.p95Ms}<sup>ms</sup>`;
  } catch { $('modeChip').textContent = 'Gateway unreachable'; }
}
async function initialize() {
  try {
    config = await readJson('/api/config');
    $('algorithm').value = config.algorithm;
    $('algorithmInfo').textContent = descriptions[config.algorithm];
    $('configText').textContent = `${config.capacity} requests per ${config.windowMs / 1000} seconds · ${config.demoSwitch ? 'demo algorithm switching enabled' : 'production algorithm lock enabled'}`;
    $('algorithm').disabled = !config.demoSwitch;
    $('clientName').disabled = !config.demoSwitch;
    $('switchNotice').textContent = config.demoSwitch ? 'Lab mode: IDs and algorithms are overridable for testing. Do not expose demo mode publicly.' : 'Production mode: client identity comes from the network IP and the algorithm cannot be overridden.';
  } catch (error) { $('configText').textContent = `Could not load configuration: ${error.message}`; }
  refresh();
  setInterval(refresh, 3000);
}
$('algorithm').addEventListener('change', () => { $('algorithmInfo').textContent = descriptions[$('algorithm').value]; });
$('clear').addEventListener('click', () => {
  $('trace').replaceChildren();
  $('trace').innerHTML = '<p class="empty">Send a burst to visualize gateway decisions.</p>';
  ['burstAllowed','burstBlocked','burstFallback'].forEach((id) => { $(id).textContent = 0; });
});
$('send').addEventListener('click', async () => {
  if (busy) return;
  const count = Math.max(1, Math.min(100, Number($('requestCount').value) || 1));
  const identity = $('clientName').value.trim() || 'demo-user';
  if (config?.demoSwitch && !/^[\w-]{1,64}$/.test(identity)) { alert('Demo ID must contain only letters, numbers, _ or -'); return; }
  busy = true;
  $('send').disabled = true;
  $('send').textContent = `Sending ${count} requests...`;
  $('trace').replaceChildren();
  const results = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const begin = performance.now();
    try {
      const url = new URL('/api/work', location.origin);
      if (config?.demoSwitch) url.searchParams.set('algorithm', $('algorithm').value);
      const response = await fetch(url, { headers: config?.demoSwitch ? { 'x-demo-client-id': identity } : {} });
      return { index, status: response.status, mode: response.headers.get('x-ratelimit-mode') || 'unknown', algorithm: response.headers.get('x-ratelimit-algorithm') || '-', duration: Math.round(performance.now() - begin) };
    } catch (error) { return { index, status: 'ERR', mode: error.message, algorithm: '-', duration: Math.round(performance.now() - begin) }; }
  }));
  let ok = 0, blocked = 0, fallback = 0;
  for (const result of results) {
    if (result.status === 200) ok++;
    if (result.status === 429) blocked++;
    if (result.mode === 'memory-fallback') fallback++;
    const line = document.createElement('div');
    line.className = 'trace-row';
    const status = document.createElement('span');
    status.className = result.status === 200 ? 'ok' : 'bad';
    status.textContent = `${result.status} ${result.status === 200 ? 'OK' : result.status === 429 ? 'LIMIT' : ''}`;
    const source = document.createElement('span');
    source.textContent = `${result.algorithm} / ${result.mode}`;
    const ms = document.createElement('span');
    ms.textContent = `${result.duration} ms`;
    line.append(status, source, ms);
    $('trace').append(line);
  }
  $('burstAllowed').textContent = ok;
  $('burstBlocked').textContent = blocked;
  $('burstFallback').textContent = fallback;
  busy = false;
  $('send').disabled = false;
  $('send').innerHTML = '⚡ Send request burst <span>→</span>';
  refresh();
});
initialize();
