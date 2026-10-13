const $ = id => document.getElementById(id);
const SIMULATION = true;
const DEFAULT_DELAY_MS = 500;

let jobId = null, pollTimer = null;

async function api(path, data) {
  const r = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'Ошибка запроса');
  return j;
}

async function signIn() {
  try {
    await api('status');
    $('login').hidden = true;
    $('simulatorHub').hidden = false;
  } catch {
    $('login').hidden = false;
    $('simulatorHub').hidden = true;
  }
}

$('simulationMode').textContent = SIMULATION
  ? 'Симуляция. Запросы не отправляются.'
  : 'Боевой режим. Запросы отправляются на сервисы.';

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('login', { password: $('password').value });
    $('password').value = '';
    $('error').textContent = '';
    await signIn();
  } catch (err) { $('error').textContent = err.message; }
};

$('simulationForm').onsubmit = async e => {
  e.preventDefault();
  if (jobId) return;

  const digits  = $('simulationPhone').value.replace(/\D/g, '');
  const count   = Number($('simulationCount').value);
  const channel = $('simulationChannel').value;
  const proxies = ($('simulationProxies').value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!/^([78])\d{10}$/.test(digits) || !Number.isInteger(count) || count < 1 || count > 30) {
    $('error').textContent = 'Введите номер +7 и от 1 до 30 шагов.';
    return;
  }

  clearAll();
  $('error').textContent = '';
  $('simulationStart').disabled = true;
  $('simulationStop').disabled  = false;

  try {
    const job = await api('dispatch', {
      phone: digits,
      count,
      channel,
      delay: DEFAULT_DELAY_MS,
      simulation: SIMULATION,
      proxies,
    });
    jobId = job.id;
    $('simulationSummary').textContent =
      `Задача ${job.id} · ${job.phone} · 0 / ${job.total}`;
    startPolling();
  } catch (err) {
    $('error').textContent = err.message;
    $('simulationStart').disabled = false;
    $('simulationStop').disabled  = true;
  }
};

function startPolling() {
  pollTimer = setInterval(async () => {
    if (!jobId) return;
    try {
      const s = await api('job/' + jobId);
      renderLog(s.events);
      $('simulationSummary').textContent =
        `Задача ${s.id} · отправлено: ${s.sent} / ${s.total} · ошибок: ${s.failed} · ${s.elapsed}s`;
      if (s.done) {
        stopPolling();
        jobId = null;
        $('simulationStart').disabled = false;
        $('simulationStop').disabled  = true;
      }
    } catch (err) { $('error').textContent = err.message; }
  }, 1000);
}

function renderLog(events) {
  const log = $('simulationLog');
  log.replaceChildren();
  for (const ev of events) {
    const row = document.createElement('li');
    const tag = ev.channel === 'call' ? 'Звонок'
              : ev.channel === 'sms'  ? 'SMS'
              : ev.channel;
    row.textContent = `${ev.seq}. ${tag} · ${ev.name} · ${ev.status}`
                    + (ev.http ? ` [${ev.http}]` : '')
                    + (ev.error ? ` · ${ev.error}` : '');
    log.append(row);
  }
}

function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

function clearAll() {
  stopPolling();
  jobId = null;
  $('simulationLog').replaceChildren();
  $('simulationSummary').textContent = '';
  $('simulationStart').disabled = false;
  $('simulationStop').disabled  = true;
}

$('simulationStop').onclick = async () => {
  if (!jobId) return;
  try {
    await api('job/' + jobId + '/stop', {});
    $('simulationSummary').textContent = 'Остановка запрошена...';
  } catch (err) { $('error').textContent = err.message; }
};

$('simulationClear').onclick = clearAll;
window.addEventListener('pagehide', stopPolling);

void signIn();
