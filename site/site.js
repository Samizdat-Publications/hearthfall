// Hearthfall landing page: clips play while on screen, the top bar turns solid past the hero, and the tour
// gets a clickable chapter list from media/chapters.json. The page works without this script.
(function () {
  "use strict";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- top bar
  const bar = document.querySelector(".bar");
  const hero = document.querySelector(".hero");
  const onBar = () => bar.classList.toggle("solid", window.scrollY > hero.offsetHeight * 0.6);
  window.addEventListener("scroll", onBar, { passive: true });
  onBar();

  // ---------------------------------------------------------------- hero loop (still poster for reduced motion)
  const heroVideo = document.querySelector(".hero-video");
  if (reduced && heroVideo) {
    heroVideo.removeAttribute("autoplay");
    heroVideo.pause();
  }

  // ---------------------------------------------------------------- section clips play in view
  const clips = [...document.querySelectorAll("video[data-inview]")];
  const play = (v) => {
    if (reduced) return;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  };
  if ("IntersectionObserver" in window) {
    // start loading a little before a clip scrolls in
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.preload = "auto";
            near.unobserve(e.target);
          }
      },
      { rootMargin: "600px 0px" },
    );
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? play : (v) => v.pause())(e.target);
      },
      { threshold: 0.35 },
    );
    for (const v of clips) {
      near.observe(v);
      seen.observe(v);
    }
  } else for (const v of clips) v.setAttribute("controls", "");

  // ---------------------------------------------------------------- tour chapters
  const tour = document.getElementById("tour-video");
  const list = document.getElementById("chapters");
  if (!tour || !list) return;
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  fetch("media/chapters.json")
    .then((r) => r.json())
    .then((data) => {
      const items = data.chapters.map((c) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const time = document.createElement("time");
        time.textContent = mmss(c.t);
        b.append(time, document.createTextNode(c.title));
        b.addEventListener("click", () => {
          tour.preload = "auto";
          const go = () => {
            tour.currentTime = c.t;
            tour.play().catch(() => {});
          };
          if (tour.readyState >= 1) go();
          else tour.addEventListener("loadedmetadata", go, { once: true });
        });
        li.append(b);
        list.append(li);
        return { t: c.t, b };
      });
      tour.addEventListener("timeupdate", () => {
        let cur = 0;
        items.forEach((it, i) => {
          if (tour.currentTime >= it.t - 0.05) cur = i;
        });
        items.forEach((it, i) => it.b.classList.toggle("on", i === cur));
      });
    })
    .catch(() => {});
})();
