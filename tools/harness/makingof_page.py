# Builds the "making of" page (making-of/site/) from making-of/index.json and making-of/chapters.json.
# Images are re-encoded as WebP (max 1600 px wide, sheets 2000) into making-of/site/img/, the page is
# making-of/site/index.html (from tools/harness/makingof_template.html), and making-of/site/publish.json
# maps every published path to its source, so a session can republish it to the Artifact URL recorded in
# making-of/README.md. Run through node: npm run making-of -- page
import html
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCH = os.path.join(ROOT, "making-of")
SITE = os.path.join(ARCH, "site")
IMG = os.path.join(SITE, "img")
RUN_START = datetime(2026, 10, 8, 21, 25, tzinfo=timezone.utc)
DASHES = (chr(0x2014), chr(0x2013))

CHANGE_LABEL = {"added": "Added", "changed": "Changed", "fixed": "Fixed", "removed": "Removed", "explored": "Explored"}
KIND_LABEL = {"concept": "Concept art", "screenshot": "Screenshot", "contact-sheet": "Contact sheet", "asset-sheet": "Asset sheet", "asset-thumb": "Asset", "comparison": "Before and after", "diagram": "Diagram"}


def default_change(e):
    """What the image shows happening to the game, when the entry does not say (index entries may set "change")."""
    if e.get("change") in CHANGE_LABEL:
        return e["change"]
    if e["kind"] == "concept":
        return "explored"
    if e["kind"] == "comparison":
        return "changed"
    return "added"


def webp(e):
    src = os.path.join(ARCH, e["file"])
    name = os.path.splitext(re.sub(r"[^a-z0-9_.-]", "-", e["file"].lower().replace("/", "_")))[0] + ".webp"
    dst = os.path.join(IMG, name)
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        im = Image.open(src)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        cap = 2000 if e["kind"] in ("contact-sheet", "asset-sheet") else 1600
        if im.width > cap:
            im = im.resize((cap, round(im.height * cap / im.width)), Image.LANCZOS)
        im.save(dst, "WEBP", quality=82, method=5)
    with Image.open(dst) as im:
        size = im.size
    return "img/" + name, size


def when_label(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.strftime("%b %d, %H:%M UTC").replace(" 0", " ")


def hours_in(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (d - RUN_START).total_seconds() / 3600


def tag_of(e):
    if re.fullmatch(r"B\d+", e["milestone"]):
        m = re.match(r"\s*BACKLOG (\w+)", e["caption"])
        return ("Backlog " + m.group(1)) if m else "Backlog " + e["milestone"][1:]
    return e["milestone"]


def git_gates():
    """Milestone exits (tags m<n>-done) and finished backlog items (newest 'BACKLOG <id>:' commit), as hours into the run."""
    gates = []
    try:
        out = subprocess.run(["git", "for-each-ref", "--format=%(refname:short) %(creatordate:iso-strict)", "refs/tags"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            m = re.fullmatch(r"m(\d+)-done (\S+)", line.strip())
            if m:
                gates.append({"kind": "milestone", "label": "M" + m.group(1), "title": "Milestone M" + m.group(1) + " passed", "hour": round(hours_in(m.group(2)), 3)})
        done = set()
        with open(os.path.join(ROOT, "docs", "BACKLOG.md"), encoding="utf-8") as f:
            for line in f:
                m = re.match(r"(\w+)\. \[\w\] (?:\(done|DONE)", line)
                if m:
                    done.add(m.group(1))
        log = subprocess.run(["git", "log", "--format=%cI %s"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        seen = set()
        for line in log.splitlines():
            m = re.match(r"(\S+) BACKLOG (\w+):", line)
            if m and m.group(2) in done and m.group(2) not in seen:
                seen.add(m.group(2))
                gates.append({"kind": "backlog", "label": "B" + m.group(2), "title": "Backlog item " + m.group(2) + " finished", "hour": round(hours_in(m.group(1)), 3)})
    except (OSError, subprocess.CalledProcessError):
        pass
    gates.sort(key=lambda g: g["hour"])
    return gates


def main():
    idx = json.load(open(os.path.join(ARCH, "index.json"), encoding="utf-8"))["entries"]
    cfg = json.load(open(os.path.join(ARCH, "chapters.json"), encoding="utf-8"))
    os.makedirs(IMG, exist_ok=True)
    chapters = [dict(c, entries=[]) for c in cfg["chapters"]]

    def chapter_for(tag):
        for c in chapters:
            for t in c["tags"]:
                if tag == t or (t == "B" and re.fullmatch(r"B\d+", tag)):
                    return c
        return chapters[-1]

    files = {}
    for e in sorted(idx, key=lambda x: x["when"]):
        if not os.path.exists(os.path.join(ARCH, e["file"])):
            continue
        rel, size = webp(e)
        files[rel] = "making-of/site/" + rel
        chapter_for(e["milestone"])["entries"].append(dict(e, img=rel, size=size))

    chapters = [c for c in chapters if c["entries"]]
    flat = [e for c in chapters for e in c["entries"]]
    last = max(e["when"] for e in flat)
    heroes = [e for e in flat if e.get("highlight") and e["kind"] == "screenshot"]
    cover = heroes[-1] if heroes else flat[-1]
    shots = [e for e in flat if e["kind"] == "screenshot"]
    then = shots[0] if shots else flat[0]
    esc = html.escape
    gates = git_gates()
    max_hour = max([hours_in(last)] + [g["hour"] for g in gates]) * 1.03 + 0.2

    n = 0
    data, body, nav = [], [], []
    for ci, c in enumerate(chapters, 1):
        nav.append(f'<a href="#{esc(c["id"])}"><b>{ci:02d}</b> {esc(c["title"])}</a>')
        figs, tags = [], []
        for e in c["entries"]:
            n += 1
            w, h = e["size"]
            ch = default_change(e)
            tag = tag_of(e)
            if tag not in tags:
                tags.append(tag)
            lapse = e["kind"] in ("screenshot", "comparison") or (e.get("highlight") and e["kind"] == "contact-sheet")
            data.append({"n": n, "img": e["img"], "cap": e["caption"], "tag": tag, "milestone": e["milestone"], "kind": e["kind"], "change": ch,
                         "hero": bool(e.get("highlight")), "hour": round(hours_in(e["when"]), 3), "whenLabel": when_label(e["when"]), "lapse": bool(lapse)})
            star = '<span class="star">Hero shot</span>' if e.get("highlight") else ""
            figs.append(f"""
    <figure class="shot{' hero' if e.get('highlight') else ''}" id="img-{n}" data-n="{n}">
      <button class="frame" type="button" data-n="{n}" aria-label="View larger: {esc(e['caption'][:80])}">
        <img src="{esc(e['img'])}" width="{w}" height="{h}" loading="lazy" decoding="async" alt="{esc(e['caption'])}">
      </button>
      <figcaption>
        <div class="meta"><span class="chip change-{ch}">{CHANGE_LABEL[ch]}</span><span class="tag">{esc(tag)}</span><span>{esc(KIND_LABEL.get(e['kind'], e['kind']))}</span><time datetime="{esc(e['when'])}">{esc(when_label(e['when']))} &middot; hour {hours_in(e['when']):.1f}</time>{star}</div>
        <p>{esc(e['caption'])}</p>
      </figcaption>
    </figure>""")
        span = f'{when_label(c["entries"][0]["when"])} to {when_label(c["entries"][-1]["when"])}'
        count = len(c["entries"])
        body.append(f"""
  <section class="chapter" id="{esc(c['id'])}">
    <header class="ch-head">
      <span class="ch-num">Chapter {ci:02d}</span>
      <h2>{esc(c['title'])}</h2>
      <p class="blurb">{esc(c['blurb'])}</p>
      <p class="ch-meta">{count} image{'s' if count != 1 else ''} &middot; {esc(', '.join(tags))} &middot; {esc(span)}</p>
    </header>{''.join(figs)}
  </section>""")

    milestones = [g for g in gates if g["kind"] == "milestone"]
    backlog = [g for g in gates if g["kind"] == "backlog"]
    stats = [(str(len(flat)), "images archived"), (f"{len(milestones)} of 12", "roadmap milestones passed"),
             (str(len(backlog)), "backlog items finished"), (f"{hours_in(last):.0f}h", "into the run at the newest image")]
    cw, chh = cover["size"]
    cover_html = f"""<div class="coverimg"><img src="{esc(cover['img'])}" width="{cw}" height="{chh}" alt="{esc(cover['caption'])}">
      <div class="cap"><span class="chip">Latest hero shot</span>{esc(cover['caption'])}</div></div>"""
    compare = f"""<div class="compare" id="compare" style="--x: 50%">
      <img src="{esc(cover['img'])}" alt="Now: {esc(cover['caption'])}">
      <div class="then"><img src="{esc(then['img'])}" alt="Then: {esc(then['caption'])}"></div>
      <div class="handle"></div>
      <span class="lab l">{esc(then['milestone'])}, hour {hours_in(then['when']):.1f}</span><span class="lab r">Now, hour {hours_in(cover['when']):.1f}</span>
      <input type="range" min="0" max="100" value="50" aria-label="Slide between the first screenshot and the latest hero shot">
    </div>
    <div class="capline"><p><b>Then.</b> {esc(then['caption'])}</p><p><b>Now.</b> {esc(cover['caption'])}</p></div>"""
    payload = json.dumps({"entries": data, "gates": gates, "maxHour": round(max_hour, 3)}, ensure_ascii=False).replace("</", "<\\/")
    built = datetime.now(timezone.utc).strftime("%b %d, %H:%M UTC").replace(" 0", " ")
    footer = ("Built " + built + " from making-of/index.json and making-of/chapters.json by npm run making-of -- page. "
              "Times are UTC; hour counts from the start of the autonomous run. Tags: M is a roadmap milestone, A the asset track, Backlog an item worked after the roadmap.")
    tpl = open(os.path.join(ROOT, "tools", "harness", "makingof_template.html"), encoding="utf-8").read()
    page = (tpl.replace("%%NAV%%", "".join(nav))
            .replace("%%H1%%", " ".join(f"<span>{esc(w)}</span>" for w in cfg["title"].split()))
            .replace("%%INTRO%%", esc(cfg["intro"]))
            .replace("%%STATS%%", "".join(f'<div class="stat"><b>{esc(a)}</b><span>{esc(b)}</span></div>' for a, b in stats))
            .replace("%%COVER%%", cover_html)
            .replace("%%COMPARE%%", compare)
            .replace("%%CHAPTERS%%", "".join(body))
            .replace("%%FOOTER%%", esc(footer))
            .replace("%%DATA%%", payload))
    if any(d in page for d in DASHES):
        sys.exit("em or en dash in the page text: fix the caption or chapter text")
    with open(os.path.join(SITE, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    for name in os.listdir(IMG):
        if "img/" + name not in files:
            os.remove(os.path.join(IMG, name))
    with open(os.path.join(SITE, "publish.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"$comment": "Artifact publish map: file_path making-of/site/index.html, files = this map.", "files": files}, f, indent=1)
    total = sum(os.path.getsize(os.path.join(ROOT, v)) for v in files.values()) + len(page.encode())
    print(f"page: {len(flat)} images in {len(chapters)} chapters, {len(gates)} gates, {total / 1e6:.1f} MB, making-of/site/index.html")


if __name__ == "__main__":
    main()
