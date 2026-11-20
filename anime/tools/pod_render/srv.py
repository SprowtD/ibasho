# The short control server a rented pod starts with (same calls as the studio's rp.sh):
#   GET  /get?path=   a file          POST /put?path=   save a file          POST /run?name=   run the body as a bash script
#   GET  /log?id=     a job's log     GET  /            every job's exit code
# It runs commands by design, so (audit, 19 Nov 2026): the token must be long and is compared in constant time; files are
# read and written only under /workspace (WORKSPACE); job names are plain words; uploads have a size limit. Reach it only through
# RunPod's https proxy, and stop the pod when the job is done.
import hmac, http.server as h, json, os, re, subprocess as s, urllib.parse as u

T = os.environ.get("CTRL_TOKEN", "")
if len(T) < 24: raise SystemExit("CTRL_TOKEN must be set to a random token of at least 24 characters")
ROOT = os.path.realpath(os.environ.get("WORKSPACE", "/workspace"))
J = os.environ.get("JOBS", ROOT + "/jobs"); os.makedirs(J, exist_ok=True)
MAX_PUT = int(os.environ.get("MAX_PUT_MB", "4096")) << 20
P = {}

def inside(p):
    r = os.path.realpath(p if os.path.isabs(p) else os.path.join(ROOT, p))
    return r if r == ROOT or r.startswith(ROOT + os.sep) else None

class H(h.BaseHTTPRequestHandler):
    def o(z, b=b"ok", c=200):
        z.send_response(c); z.send_header("Content-Length", str(len(b))); z.end_headers(); z.wfile.write(b)
    def a(z):
        r = u.urlparse(z.path)
        return r.path, {k: v[0] for k, v in u.parse_qs(r.query).items()}, hmac.compare_digest(z.headers.get("X-Token", "").encode(), T.encode())
    def do_GET(z):
        p, q, k = z.a()
        if not k: return z.o(b"no", 403)
        if p == "/get":
            f = inside(q.get("path", ""))
            return z.o(open(f, "rb").read()) if f and os.path.isfile(f) else z.o(b"missing", 404)
        if p == "/log":
            j = q.get("id", "")
            if not re.fullmatch(r"[\w.-]{1,80}", j): return z.o(b"bad id", 400)
            f = J + "/" + j + ".log"; t = open(f, errors="replace").read().splitlines()[-int(q.get("tail", 40)):] if os.path.exists(f) else []
            return z.o(("[exit=%s]\n" % (P[j].poll() if j in P else "?") + "\n".join(t)).encode())
        z.o(json.dumps({k: v.poll() for k, v in P.items()}).encode())
    def do_POST(z):
        p, q, k = z.a()
        if not k: return z.o(b"no", 403)
        n = int(z.headers.get("Content-Length", 0))
        if n > MAX_PUT: return z.o(b"too large", 413)
        d = z.rfile.read(n)
        if p == "/put":
            f = inside(q.get("path", ""))
            if not f: return z.o(b"only under the workspace", 400)
            os.makedirs(os.path.dirname(f), exist_ok=True); open(f, "wb").write(d); return z.o()
        j = q.get("name", "")
        if not re.fullmatch(r"[\w.-]{1,80}", j): return z.o(b"bad name", 400)
        P[j] = s.Popen(["bash", "-lc", d.decode()], stdout=open(J + "/" + j + ".log", "w"), stderr=s.STDOUT, cwd=os.path.dirname(J)); z.o(j.encode())
    def log_message(z, *a): pass

# BIND: the address to listen on. Every address by default (RunPod's https proxy has to reach it). When the proxy is seen to
# arrive on one inner address, set BIND to that address so nothing else on the network can reach the plain-HTTP port.
h.ThreadingHTTPServer((os.environ.get("BIND", "0.0.0.0"), int(os.environ.get("PORT", 8000))), H).serve_forever()
