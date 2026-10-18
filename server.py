# -*- coding: utf-8 -*-
"""BaiRiMeng-WR 本地服务：静态站点 + 生图/图片编辑代理（多密钥轮询）

    python server.py            # http://127.0.0.1:8123
    set PORT=9000 && python server.py

代理会隐藏具体模型与密钥，前端只拿到图片地址。
"""
import base64
import json
import mimetypes
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = "https://api.agnes-ai.cn/v1"
MODEL = "agnes-image-2.5-flash"          # 内部使用，不对外暴露
PORT = int(os.environ.get("PORT", "8123"))

KEYS = [
    "sk-XZRf1tK7XDRosmTGsC3sreInYkaQWg7NdLRRMQMxiFJQQwI8",
    "sk-PL8Trn1EDDj3lJ5vNyWqvKi5NrUK1R9WpaGsHlrhyadlWnc2",
    "sk-xwQMweoBmBu4aiXregrZZHMjaD9HJZEArFKxIUCsOgt81VpT",
    "sk-QWhQ09qMsiOi2ZJxgSpauj2JFBjjK4tcaI3vwfKFcDaAmo8Y",
    "sk-PzEFqJdIMfftsMuaK6xnoh5QBvoYUYvJ63AWuLIxUFeuTBEj",
    "sk-hfYeqbSwcrSXgLRMHTqq859TMFrNAgSgxiheH3MOCK4ZJzFN",
]
_lock = threading.Lock()
_state = {"idx": 0, "dead": set(), "cool": {}}


def _pick():
    with _lock:
        now = time.time()
        n = len(KEYS)
        for i in range(n * 2):
            j = (_state["idx"] + i) % n
            k = KEYS[j]
            if k in _state["dead"] or _state["cool"].get(k, 0) > now:
                continue
            _state["idx"] = (j + 1) % n
            return k
        alive = [k for k in KEYS if k not in _state["dead"]]
        if not alive:
            return None
        wait = max(_state["cool"].get(k, 0) for k in alive) - now
        return ("__wait__", wait)


def _as_uri(item):
    s = str(item)
    if s.startswith(("http://", "https://", "data:")):
        return s
    p = s if os.path.isabs(s) else os.path.join(ROOT, s)
    if not os.path.exists(p):
        return None
    mime = mimetypes.guess_type(p)[0] or "image/png"
    with open(p, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())


def _post(key, payload, timeout=300):
    req = urllib.request.Request(
        BASE + "/images/generations",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "bairimeng-wr/1.0"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "%s: %s" % (type(e).__name__, e)


def _download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "bairimeng-wr/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(path, "wb") as f:
        f.write(r.read())


def generate(prompt, ratio="3:4", size="2K", count=1, refs=None):
    refs = [u for u in (_as_uri(r) for r in (refs or [])) if u]
    payload = {"model": MODEL, "prompt": prompt, "size": size, "ratio": ratio,
               "extra_body": {"response_format": "url"}}
    if refs:
        payload["extra_body"]["image"] = refs

    last = "未知错误"
    for attempt in range(8):
        k = _pick()
        if k is None:
            return {"ok": False, "error": "密钥池不可用"}
        if isinstance(k, tuple):
            time.sleep(min(20, max(4, k[1])))
            continue
        code, body = _post(k, payload)
        if code == 200:
            try:
                d = json.loads(body)
                items = [it for it in (d.get("data") or []) if it.get("url")]
            except Exception:
                items = []
            if not items:
                last = "服务返回空结果"
                time.sleep(3)
                continue
            outdir = os.path.join(ROOT, "assets", "img", "generated")
            os.makedirs(outdir, exist_ok=True)
            out = []
            mode_title = "新编辑作品" if refs else "新生成作品"
            for i, it in enumerate(items[:max(1, int(count))]):
                name = "%d_%d.png" % (int(time.time() * 1000), i)
                path = os.path.join(outdir, name)
                try:
                    _download(it["url"], path)
                    out.append({"src": "assets/img/generated/" + name, "url": it["url"],
                                "title": mode_title,
                                "tags": ["编辑"] if refs else ["新作"],
                                "ratio": ratio, "prompt": prompt})
                except Exception as e:
                    last = "下载失败: %s" % e
            if out:
                _remember(out)
                return {"ok": True, "items": out}
            continue
        low = body.lower()
        if code in (401, 403) or "invalid token" in low:
            with _lock:
                _state["dead"].add(k)
            continue
        if code == 429 or "too many" in low:
            with _lock:
                _state["cool"][k] = time.time() + 40
            continue
        if code == 503 or "队列已满" in body or "queue" in low:
            last = "生成队列繁忙，正在重试…"
            time.sleep(5 + attempt * 2)
            continue
        last = body[:160]
        time.sleep(3 + attempt)
    return {"ok": False, "error": last}


def _remember(items):
    """把新作品记到 data/generated.json，刷新页面后仍在画廊里。"""
    p = os.path.join(ROOT, "data", "generated.json")
    try:
        old = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
    except Exception:
        old = []
    rows = []
    for it in items:
        rows.append({
            "id": "gen-" + os.path.basename(it["src"]).replace(".png", ""),
            "title": it.get("title") or "新生成作品",
            "tags": it.get("tags") or ["新作"],
            "ratio": it.get("ratio") or "3:4",
            "prompt": it.get("prompt") or "",
            "src": it["src"],
        })
    data = rows + old
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data[:40], f, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- 灵感流（公开图库接口）
FEED_URL = "https://www.meigen.ai/api/images"
TAG_RULES = [
    (["anime", "manga", "ghibli", "waifu", "二次元", "动漫", "cel-shaded", "chibi", "vtuber"], "动漫"),
    (["poster", "海报"], "海报"),
    (["brand", "logo", "identity", "品牌", "标识"], "品牌"),
    (["product", "packaging", "unboxing", "产品", "包装"], "产品"),
    (["3d render", "octane", "blender", "c4d", "miniatu", "3d"], "3D"),
    (["ui", "dashboard", "app interface", "infographic", "信息图"], "设计"),
    (["illustration", "painting", "digital art", "插画", "水彩", "涂鸦"], "插画"),
    (["photograph", "photography", "photo", "摄影", "镜头"], "摄影"),
]


def _guess_tags(*parts):
    blob = " ".join([p for p in parts if p]).lower()
    tags = []
    for keys, tag in TAG_RULES:
        if any(k in blob for k in keys) and tag not in tags:
            tags.append(tag)
            if len(tags) >= 2:
                break
    return tags or ["设计"]


def fetch_feed(offset=0, limit=20):
    """拉取公开图库的提示词 + 图片，转成前端需要的结构（不暴露来源）。"""
    req = urllib.request.Request(
        "%s?offset=%d" % (FEED_URL, int(offset)),
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"ok": False, "error": "拉取失败: %s" % e}
    out = []
    for it in (data.get("images") or [])[:int(limit)]:
        src = (it.get("images") or [it.get("image")])[0] if it.get("images") or it.get("image") else None
        if not src:
            continue
        prompt = (it.get("prompt") or "").strip()
        title = (it.get("title") or "").strip().split("\n")[0][:28] or "灵感作品"
        out.append({
            "id": "feed-" + str(it.get("id")),
            "title": title,
            "tags": _guess_tags(title, prompt),
            "ratio": "3:4",
            "prompt": prompt,
            "src": src,
        })
    return {"ok": True, "items": out, "total": data.get("totalCount", 0)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/feed"):
            import urllib.parse as up
            q = up.parse_qs(up.urlparse(self.path).query)
            off = int((q.get("offset") or ["0"])[0])
            lim = int((q.get("limit") or ["20"])[0])
            res = fetch_feed(off, lim)
            self._json(res, 200 if res.get("ok") else 502)
            return
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            self._json({"ok": False, "error": "请求体解析失败"}, 400)
            return
        prompt = (data.get("prompt") or "").strip()
        if not prompt:
            self._json({"ok": False, "error": "提示词不能为空"}, 400)
            return
        res = generate(prompt,
                       ratio=data.get("ratio") or "3:4",
                       size=data.get("size") or "2K",
                       count=data.get("count") or 1,
                       refs=data.get("refs") or [])
        self._json(res, 200 if res.get("ok") else 502)

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("BaiRiMeng-WR  →  http://127.0.0.1:%d" % PORT, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
