#!/usr/bin/env python3
"""LinguaLab sync server: Telegram login + per-user progress storage.

Standard library only. Runs behind nginx (https://<host>/lingua/ → http://127.0.0.1:PORT/).

Login: the app gets signed user data from the official Telegram login (oauth.telegram.org) and
posts it here; the signature is checked with the bot token (no calls to the Telegram API).
Storage: opaque blobs (gzip JSON made by the app) per user and key, with a revision number so two
devices can't overwrite each other blindly (PUT with a stale ?base= gets 409; the app merges and
retries).

Bug reports: the app posts reports (text + the exercise and app version) to /reports; each user
sees their own with a status. Reports are handled on the server with the command line:
  python3 lingualab_sync.py reports [all]            list (open ones by default)
  python3 lingualab_sync.py report <id>              show one in full
  python3 lingualab_sync.py status <id> <status> [note] [version]
statuses: new, progress, fixed, wontfix

Environment:
  BOT_TOKEN    token of the login bot (required)
  PORT         default 8095
  DB           default ./lingualab.db
  ORIGINS      allowed web origins, comma-separated
  ALLOWED_IDS  optional: only these Telegram user ids may sign in (comma-separated)
  MAX_USERS    default 6
"""
import hashlib, hmac, json, os, re, secrets, sqlite3, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
PORT = int(os.environ.get("PORT", "8095"))
DB = os.environ.get("DB", "lingualab.db")
ORIGINS = {o.strip() for o in os.environ.get(
    "ORIGINS", "https://fostron.github.io,http://localhost:5180,http://localhost:4180").split(",") if o.strip()}
ALLOWED_IDS = {int(x) for x in os.environ.get("ALLOWED_IDS", "").split(",") if x.strip().isdigit()}
MAX_USERS = int(os.environ.get("MAX_USERS", "6"))
MAX_BLOB = 20 * 1024 * 1024
MAX_KEYS = 40
SESSION_TTL = 180 * 86400
KEY_RE = re.compile(r"^[a-z0-9:_.-]{1,48}$")

_local = threading.local()


def db():
    c = getattr(_local, "c", None)
    if c is None:
        c = sqlite3.connect(DB, timeout=10)
        c.execute("pragma journal_mode=wal")
        _local.c = c
    return c


def init_db():
    c = db()
    c.executescript("""
    create table if not exists users (id integer primary key, name text, username text, photo text,
                                      created integer, last_seen integer);
    create table if not exists sessions (token_hash text primary key, uid integer, created integer, last_used integer);
    create table if not exists blobs (uid integer, key text, rev integer, updated integer, data blob,
                                      primary key (uid, key));
    create table if not exists reports (id integer primary key autoincrement, uid integer, created integer,
                                        text text, context text, status text default 'new', note text,
                                        fixed_in text, updated integer);
    """)
    c.commit()


def verify_telegram(data):
    """Telegram login widget check: HMAC-SHA256 of the sorted fields, keyed with SHA256(bot token)."""
    h = str(data.get("hash", ""))
    if not h or not BOT_TOKEN:
        return False
    fields = {k: v for k, v in data.items() if k != "hash" and v is not None and v != ""}
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hashlib.sha256(BOT_TOKEN.encode()).digest()
    calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    try:
        fresh = time.time() - int(data.get("auth_date", 0)) < 86400
    except (TypeError, ValueError):
        return False
    return fresh and hmac.compare_digest(calc, h)


_hits = {}


def rate_ok(ip, limit=30, window=600):
    now = time.time()
    xs = [t for t in _hits.get(ip, []) if now - t < window]
    xs.append(now)
    _hits[ip] = xs
    return len(xs) <= limit


class H(BaseHTTPRequestHandler):
    server_version = "LinguaLabSync/1"

    def log_message(self, fmt, *args):  # quiet: method, path and status only
        pass

    # ---- helpers ----
    def cors(self):
        o = self.headers.get("Origin")
        if o in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Rev, X-Updated")
            self.send_header("Access-Control-Max-Age", "600")

    def send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def body(self, limit=MAX_BLOB):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("too large")
        return self.rfile.read(n) if n else b""

    def ip(self):
        return self.headers.get("CF-Connecting-IP") or self.headers.get("X-Real-IP") or self.client_address[0]

    def user(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        th = hashlib.sha256(auth[7:].strip().encode()).hexdigest()
        c = db()
        row = c.execute("select uid, last_used from sessions where token_hash=?", (th,)).fetchone()
        if not row or time.time() - row[1] > SESSION_TTL:
            return None
        now = int(time.time())
        c.execute("update sessions set last_used=? where token_hash=?", (now, th))
        c.execute("update users set last_seen=? where id=?", (now, row[0]))
        c.commit()
        return row[0]

    def user_json(self, uid):
        r = db().execute("select id, name, username, photo from users where id=?", (uid,)).fetchone()
        return {"id": r[0], "name": r[1], "username": r[2], "photo": r[3]} if r else None

    # ---- routes ----
    def do_OPTIONS(self):
        self.send(204, b"")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            return self.send(200, {"ok": True})
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "auth"})
        if u.path == "/me":
            return self.send(200, self.user_json(uid))
        if u.path == "/reports":
            rows = db().execute("select id, created, text, status, note, fixed_in, updated from reports where uid=? order by id desc limit 100", (uid,)).fetchall()
            return self.send(200, [{"id": i, "created": cr, "text": tx, "status": st, "note": no, "fixedIn": fi, "updated": up}
                                   for i, cr, tx, st, no, fi, up in rows])
        if u.path == "/data":
            rows = db().execute("select key, rev, updated, length(data) from blobs where uid=?", (uid,)).fetchall()
            return self.send(200, [{"key": k, "rev": r, "updated": t, "size": n} for k, r, t, n in rows])
        m = re.match(r"^/data/([^/]+)$", u.path)
        if m and KEY_RE.match(m.group(1)):
            row = db().execute("select rev, updated, data from blobs where uid=? and key=?", (uid, m.group(1))).fetchone()
            if not row:
                return self.send(404, {"error": "none"})
            return self.send(200, row[2], "application/octet-stream", {"X-Rev": str(row[0]), "X-Updated": str(row[1])})
        self.send(404, {"error": "path"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/auth/telegram":
            if not rate_ok(self.ip()):
                return self.send(429, {"error": "slow down"})
            try:
                data = json.loads(self.body(10000) or b"{}")
            except ValueError:
                return self.send(400, {"error": "json"})
            if not isinstance(data, dict) or not verify_telegram(data):
                return self.send(403, {"error": "signature"})
            tid = int(data["id"])
            if ALLOWED_IDS and tid not in ALLOWED_IDS:
                return self.send(403, {"error": "not allowed"})
            c = db()
            now = int(time.time())
            exists = c.execute("select 1 from users where id=?", (tid,)).fetchone()
            if not exists and c.execute("select count(*) from users").fetchone()[0] >= MAX_USERS:
                return self.send(403, {"error": "registration closed"})
            name = " ".join(x for x in (data.get("first_name"), data.get("last_name")) if x)
            if exists:
                c.execute("update users set name=?, username=?, photo=?, last_seen=? where id=?",
                          (name, data.get("username"), data.get("photo_url"), now, tid))
            else:
                c.execute("insert into users values (?,?,?,?,?,?)", (tid, name, data.get("username"), data.get("photo_url"), now, now))
            token = secrets.token_urlsafe(32)
            c.execute("insert into sessions values (?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), tid, now, now))
            c.commit()
            return self.send(200, {"token": token, "user": self.user_json(tid)})
        if u.path == "/reports":
            uid = self.user()
            if uid is None:
                return self.send(401, {"error": "auth"})
            try:
                data = json.loads(self.body(60000) or b"{}")
            except ValueError:
                return self.send(400, {"error": "json"})
            text = str(data.get("text", "")).strip()[:4000]
            if not text:
                return self.send(400, {"error": "empty"})
            c = db()
            day_ago = int(time.time()) - 86400
            if c.execute("select count(*) from reports where uid=? and created>?", (uid, day_ago)).fetchone()[0] >= 50:
                return self.send(429, {"error": "too many reports today"})
            now = int(time.time())
            ctx = json.dumps(data.get("context") or {}, ensure_ascii=False)[:40000]
            cur = c.execute("insert into reports (uid, created, text, context, status, updated) values (?,?,?,?, 'new', ?)", (uid, now, text, ctx, now))
            c.commit()
            return self.send(200, {"id": cur.lastrowid})
        if u.path == "/auth/logout":
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                db().execute("delete from sessions where token_hash=?", (hashlib.sha256(auth[7:].strip().encode()).hexdigest(),))
                db().commit()
            return self.send(200, {"ok": True})
        self.send(404, {"error": "path"})

    def do_PUT(self):
        u = urlparse(self.path)
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "auth"})
        m = re.match(r"^/data/([^/]+)$", u.path)
        if not m or not KEY_RE.match(m.group(1)):
            return self.send(404, {"error": "path"})
        key = m.group(1)
        try:
            data = self.body()
        except ValueError:
            return self.send(413, {"error": "too large"})
        base = parse_qs(u.query).get("base", ["0"])[0]
        base = int(base) if base.isdigit() else 0
        c = db()
        with c:
            row = c.execute("select rev from blobs where uid=? and key=?", (uid, key)).fetchone()
            cur = row[0] if row else 0
            if cur != base:
                return self.send(409, {"error": "conflict", "rev": cur})
            if not row and c.execute("select count(*) from blobs where uid=?", (uid,)).fetchone()[0] >= MAX_KEYS:
                return self.send(403, {"error": "too many keys"})
            now = int(time.time())
            c.execute("insert or replace into blobs values (?,?,?,?,?)", (uid, key, cur + 1, now, data))
        self.send(200, {"rev": cur + 1, "updated": now})

    def do_DELETE(self):
        u = urlparse(self.path)
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "auth"})
        m = re.match(r"^/data/([^/]+)$", u.path)
        if not m:
            return self.send(404, {"error": "path"})
        db().execute("delete from blobs where uid=? and key=?", (uid, m.group(1)))
        db().commit()
        self.send(200, {"ok": True})


def cli(args):
    """Handle reports from the server's command line (see the module docstring)."""
    import datetime
    init_db()
    c = db()
    fmt = lambda ts: datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    if args[0] == "reports":
        q = "select r.id, r.created, u.name, r.status, r.text, r.fixed_in from reports r left join users u on u.id=r.uid"
        if not (len(args) > 1 and args[1] == "all"):
            q += " where r.status in ('new','progress')"
        for i, cr, name, st, tx, fi in c.execute(q + " order by r.id"):
            print(f"#{i} [{st}{' ' + fi if fi else ''}] {fmt(cr)} {name}: {tx[:160]!r}")
    elif args[0] == "report":
        r = c.execute("select r.*, u.name from reports r left join users u on u.id=r.uid where r.id=?", (int(args[1]),)).fetchone()
        if not r:
            raise SystemExit("no such report")
        cols = [d[0] for d in c.execute("select r.*, u.name from reports r left join users u on u.id=r.uid limit 0").description]
        for k, v in zip(cols, r):
            if k == "context" and v:
                v = json.dumps(json.loads(v), ensure_ascii=False, indent=1)
            print(f"{k}: {v}")
    elif args[0] == "status":
        rid, st = int(args[1]), args[2]
        if st not in ("new", "progress", "fixed", "wontfix"):
            raise SystemExit("status: new | progress | fixed | wontfix")
        note = args[3] if len(args) > 3 else None
        ver = args[4] if len(args) > 4 else None
        c.execute("update reports set status=?, note=coalesce(?, note), fixed_in=coalesce(?, fixed_in), updated=? where id=?",
                  (st, note, ver, int(time.time()), rid))
        c.commit()
        print("ok")
    else:
        raise SystemExit("commands: reports [all] | report <id> | status <id> <status> [note] [version]")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cli(sys.argv[1:])
        raise SystemExit(0)
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is not set")
    init_db()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"LinguaLab sync on 127.0.0.1:{PORT}, db {DB}", flush=True)
    srv.serve_forever()
