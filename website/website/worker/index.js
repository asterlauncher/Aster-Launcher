const REPOSITORY_URL = "https://github.com/asterlauncher/Aster-Launcher";

const securityHeaders = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const SITE_JS = `
(() => {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const videos = Array.from(document.querySelectorAll("video"));

  const syncMotion = () => {
    if (mediaQuery.matches) {
      videos.forEach((video) => video.pause());
      document.documentElement.classList.add("reduced-motion");
      return;
    }

    document.documentElement.classList.remove("reduced-motion");
    videos.forEach((video) => video.play().catch(() => {}));
  };

  syncMotion();
  mediaQuery.addEventListener?.("change", syncMotion);

  const canvas = document.querySelector(".ambient-pixels");
  const context = canvas?.getContext("2d");
  let pixelFrame = 0;
  let lastPixelPaint = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let pointerEnergy = 0;
  let lastScroll = window.scrollY;
  let scrollVelocity = 0;
  let scrollTarget = 0;

  const resizePixels = () => {
    if (!canvas || !context) return;
    const density = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * density);
    canvas.height = Math.round(window.innerHeight * density);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    context.setTransform(density, 0, 0, density, 0, 0);
  };

  const drawPixels = (timestamp = 0) => {
    if (!canvas || !context) return;
    if (!mediaQuery.matches && timestamp - lastPixelPaint < 32) {
      pixelFrame = window.requestAnimationFrame(drawPixels);
      return;
    }
    lastPixelPaint = timestamp;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const spacing = width < 600 ? 13 : 12;
    const time = timestamp * 0.00025;
    const scrollRange = Math.max(1, document.documentElement.scrollHeight - height);
    const progress = window.scrollY / scrollRange;
    scrollVelocity += (scrollTarget - scrollVelocity) * 0.16;
    scrollTarget *= 0.82;
    pointerEnergy *= 0.975;
    const speed = Math.min(1, Math.abs(scrollVelocity) / 75);

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fff";

    for (let y = spacing / 2; y < height; y += spacing) {
      const normalizedY = y / height;
      for (let x = spacing / 2; x < width; x += spacing) {
        const normalizedX = x / width;
        const waveA = Math.sin(normalizedX * 9.5 + time * 2.3 + progress * 14) * 0.12;
        const waveB = Math.cos(normalizedX * 5.5 - time * 1.7 - progress * 9) * 0.09;
        const ridgeA = Math.exp(-Math.pow((normalizedY - 0.35 - waveA) / 0.12, 2));
        const ridgeB = Math.exp(-Math.pow((normalizedY - 0.72 - waveB) / 0.15, 2));
        const interference = 0.5 + 0.5 * Math.sin(
          normalizedX * 17 + normalizedY * 12 + progress * 20 + time * 2
        );
        const grain = 0.5 + 0.5 * Math.sin(x * 0.043 + y * 0.029 + time * 5.4) *
          Math.cos(x * 0.021 - y * 0.035 - time * 3.7);
        const distance = Math.hypot(normalizedX - pointerX, normalizedY - pointerY);
        const pointerField = Math.exp(-distance * 8.5) * pointerEnergy;
        const pointerRipple = 0.5 + 0.5 * Math.sin(distance * 54 - time * 8);
        const field = Math.min(1, ridgeA * 0.72 + ridgeB * 0.62 + interference * 0.2);
        const alpha = Math.min(0.6,
          0.06 + grain * 0.05 + field * (0.04 + grain * 0.2) +
          pointerField * pointerRipple * 0.32 + speed * field * 0.12
        );
        const size = 0.65 + grain * 1.7 + speed * field * 0.9;
        const trail = speed * field * (3 + grain * 8);
        const shiftedY = y + scrollVelocity * (0.08 + field * 0.075);

        context.globalAlpha = alpha;
        context.fillRect(x - size / 2, shiftedY - size / 2, size, size + trail);
      }
    }

    context.globalAlpha = 1;
    if (!mediaQuery.matches) pixelFrame = window.requestAnimationFrame(drawPixels);
  };

  const restartPixels = () => {
    window.cancelAnimationFrame(pixelFrame);
    resizePixels();
    drawPixels(mediaQuery.matches ? 0 : performance.now());
  };

  restartPixels();
  window.addEventListener("resize", restartPixels, { passive: true });
  window.addEventListener("scroll", () => {
    const delta = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    scrollTarget = Math.max(-90, Math.min(90, scrollTarget + delta * 0.55));
  }, { passive: true });
  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX / window.innerWidth;
    pointerY = event.clientY / window.innerHeight;
    pointerEnergy = 1;
  }, { passive: true });
  window.addEventListener("pointerleave", () => { pointerEnergy = 0; });
  mediaQuery.addEventListener?.("change", restartPixels);

  const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
  if (mediaQuery.matches || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14 });
    revealItems.forEach((item) => observer.observe(item));
  }
})();
`;

const styles = `
:root{
  color-scheme:dark;
  --background:#030303;
  --surface:rgba(8,8,8,.94);
  --line:rgba(255,255,255,.22);
  --line-soft:rgba(255,255,255,.09);
  --text:#f5f5f5;
  --muted:#999;
}
*{box-sizing:border-box}
html,body{margin:0;min-width:300px;min-height:100%;background:var(--background);color:var(--text)}
html{font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;text-rendering:optimizeLegibility;scroll-behavior:smooth;scrollbar-width:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}
body{min-height:100vh;overflow-x:hidden;-ms-overflow-style:none}
a{color:inherit}
.skip-link{position:fixed;z-index:30;left:14px;top:14px;padding:10px 14px;background:#fff;color:#000;transform:translateY(-180%)}
.skip-link:focus{transform:none}
.home{position:relative;isolation:isolate;overflow:hidden;background:#030303}
.landing{
  position:relative;z-index:1;min-height:100svh;display:grid;place-items:center;
  padding:40px 24px 72px;overflow:hidden;background:transparent
}
.ambient-pixels{position:fixed;z-index:-4;inset:0;width:100%;height:100%;opacity:.92;pointer-events:none}
.ambient-shade{
  position:fixed;z-index:-3;inset:0;background:
    radial-gradient(circle at 50% 46%,rgba(255,255,255,.025),transparent 24rem),
    linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.42))
}
.grid{
  position:fixed;z-index:-2;inset:0;opacity:.5;pointer-events:none;
  background-image:linear-gradient(var(--line-soft) 1px,transparent 1px),linear-gradient(90deg,var(--line-soft) 1px,transparent 1px);
  background-size:96px 96px;background-position:center center;
  -webkit-mask-image:radial-gradient(circle at center,#000 15%,transparent 82%);mask-image:radial-gradient(circle at center,#000 15%,transparent 82%)
}
.core-card{width:min(425px,calc(100vw - 32px));border:1px solid rgba(255,255,255,.36);background:rgba(4,4,4,.94);box-shadow:0 34px 90px rgba(0,0,0,.68)}
.core-visual{position:relative;aspect-ratio:425/196;overflow:hidden;border-bottom:1px solid var(--line);background:#050505}
.core-visual video{position:absolute;width:159.53%;height:auto;max-width:none;left:-30.12%;top:-74.5%;filter:grayscale(1) contrast(1.12)}
.core-visual::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 45px rgba(0,0,0,.42)}
.core-copy{padding:31px 28px 27px}
.brand-label{margin:0 0 18px;color:#a8a8a8;font-size:10px;font-weight:650;letter-spacing:.19em}
h1{margin:0;max-width:340px;font-size:clamp(28px,7.7vw,38px);font-weight:480;letter-spacing:-.035em;line-height:1.06}
.intro{margin:17px 0 30px;max-width:355px;color:var(--muted);font-size:14px;line-height:1.55}
.actions{display:grid;grid-template-columns:1fr auto auto;gap:9px;align-items:center}
.action{
  min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 13px;
  border:1px solid rgba(255,255,255,.27);background:#0d0d0d;color:#cecece;text-decoration:none;
  font:500 12px/1 Inter,"Segoe UI",sans-serif;white-space:nowrap;transition:background .16s,color .16s,border-color .16s
}
.action:hover,.action:focus-visible{background:#191919;border-color:#777;color:#fff;outline:none}
.action-primary{border-color:#fff;background:#f4f4f4;color:#080808;cursor:default}
.action-primary:hover{border-color:#fff;background:#f4f4f4;color:#080808}
.arrow{font-size:17px;line-height:0;transform:translateY(-1px)}
.scroll-cue{
  position:absolute;bottom:22px;left:50%;display:flex;align-items:center;gap:9px;color:#777;
  font-size:10px;letter-spacing:.12em;text-decoration:none;text-transform:uppercase;transform:translateX(-50%)
}
.scroll-cue span{color:#bbb;font-size:15px;animation:scrollPulse 1.8s ease-in-out infinite}
.content-section{position:relative;z-index:1;min-height:100svh;display:grid;place-items:center;padding:90px 24px}
.section-card{width:min(900px,100%);border:1px solid var(--line);background:rgba(4,4,4,.94);box-shadow:0 34px 90px rgba(0,0,0,.48)}
.section-head{display:grid;grid-template-columns:90px 1fr 1fr;gap:32px;padding:42px;border-bottom:1px solid var(--line)}
.section-number{margin:5px 0 0;color:#737373;font-size:10px;font-weight:650;letter-spacing:.16em}
.section-head h2,.closing-card h2{margin:0;font-size:clamp(32px,5vw,54px);font-weight:480;letter-spacing:-.04em;line-height:1.02}
.section-head p{margin:3px 0 0;color:var(--muted);font-size:14px;line-height:1.65}
.feature-list{display:grid;grid-template-columns:repeat(3,1fr)}
.feature{min-height:215px;padding:31px;border-right:1px solid var(--line)}
.feature:last-child{border-right:0}
.feature-index{display:block;margin-bottom:62px;color:#6f6f6f;font-size:10px;letter-spacing:.14em}
.feature h3{margin:0 0 11px;font-size:18px;font-weight:520}
.feature p{margin:0;color:#888;font-size:13px;line-height:1.6}
.workflow-card{display:grid;grid-template-columns:1fr 1fr}
.workflow-copy{padding:48px;border-right:1px solid var(--line)}
.workflow-copy h2{margin:0;font-size:clamp(34px,5vw,56px);font-weight:480;letter-spacing:-.04em;line-height:1.02}
.workflow-copy p{margin:24px 0 0;color:var(--muted);font-size:14px;line-height:1.65}
.workflow-list{display:grid}
.workflow-item{display:grid;grid-template-columns:40px 1fr;gap:18px;padding:30px;border-bottom:1px solid var(--line)}
.workflow-item:last-child{border-bottom:0}
.workflow-item>span{color:#747474;font-size:10px;letter-spacing:.12em}
.workflow-item h3{margin:0 0 7px;font-size:16px;font-weight:520}
.workflow-item p{margin:0;color:#858585;font-size:13px;line-height:1.55}
.closing-section{min-height:88svh}
.closing-card{width:min(425px,calc(100vw - 32px));padding:38px 28px 29px;border:1px solid var(--line);background:rgba(4,4,4,.95);text-align:left}
.closing-card p:not(.brand-label){margin:20px 0 30px;color:var(--muted);font-size:14px;line-height:1.6}
.closing-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.site-footer{position:relative;z-index:1;display:flex;justify-content:center;gap:16px;padding:0 20px 28px;color:#777;font-size:11px}
.site-footer a{text-decoration:none}.site-footer a:hover,.site-footer a:focus-visible{color:#fff}
[data-reveal]{opacity:0;transform:translateY(34px);transition:opacity .75s ease,transform .75s cubic-bezier(.2,.8,.2,1)}
[data-reveal].is-visible{opacity:1;transform:none}
@keyframes scrollPulse{0%,100%{transform:translateY(-2px);opacity:.55}50%{transform:translateY(3px);opacity:1}}
.document-page{
  min-height:100svh;padding:70px 22px;background:
    linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px),#030303;
  background-size:96px 96px
}
.document-card{width:min(720px,100%);margin:0 auto;border:1px solid var(--line);background:rgba(5,5,5,.97)}
.document-head{padding:32px;border-bottom:1px solid var(--line)}
.document-head a{display:inline-flex;margin-bottom:29px;color:#aaa;font-size:12px;text-decoration:none}.document-head a:hover{color:#fff}
.document-head h1{font-size:clamp(32px,7vw,52px)}
.document-head p{margin:15px 0 0;color:var(--muted);font-size:14px;line-height:1.6}
.document-content{padding:9px 32px 35px}
.document-content h2{margin:31px 0 9px;color:#eee;font-size:13px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.document-content p,.document-content li{color:#aaa;font-size:14px;line-height:1.7}
.document-content ul{padding-left:20px}.document-content a{color:#fff}
.retired{min-height:100svh;display:grid;place-items:center;padding:28px;background:#030303;text-align:center}
.retired div{width:min(470px,100%);padding:36px;border:1px solid var(--line)}
.retired h1{margin:auto}.retired p{color:var(--muted)}
.retired a{display:inline-flex;margin-top:16px}
@media(max-width:480px){
  .landing{padding:24px 16px 68px}
  .core-copy{padding:25px 22px 22px}
  .intro{font-size:13px;margin-bottom:24px}
  .actions{grid-template-columns:1fr 1fr}.action-primary{grid-column:1/-1;grid-row:2}
  .content-section{padding:70px 16px}
  .section-head{grid-template-columns:1fr;gap:18px;padding:28px 22px}
  .feature-list{grid-template-columns:1fr}
  .feature{min-height:auto;padding:25px 22px;border-right:0;border-bottom:1px solid var(--line)}
  .feature:last-child{border-bottom:0}.feature-index{margin-bottom:25px}
  .workflow-card{grid-template-columns:1fr}.workflow-copy{padding:31px 22px;border-right:0;border-bottom:1px solid var(--line)}
  .workflow-item{padding:25px 22px}
  .document-head,.document-content{padding-left:23px;padding-right:23px}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;transition:none!important}
  [data-reveal]{opacity:1;transform:none}.scroll-cue span{animation:none}
}
`;

function shell({ title, description, path, content }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#030303">
  <meta name="description" content="${description}">
  <link rel="canonical" href="https://asterlauncher.com${path}">
  <link rel="icon" href="/aster-icon.png" type="image/png">
  <title>${title}</title>
  <style>${styles}</style>
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  ${content}
  <script src="/site.js" defer></script>
</body>
</html>`;
}

function home() {
  return shell({
    title: "Aster — One place for your mods",
    description: "Aster keeps your games, mods and profiles together in one simple launcher.",
    path: "/",
    content: `<main class="home" id="content">
      <canvas class="ambient-pixels" aria-hidden="true"></canvas>
      <div class="ambient-shade" aria-hidden="true"></div>
      <div class="grid" aria-hidden="true"></div>
      <section class="landing" aria-label="Introduction">
        <section class="core-card" aria-labelledby="hero-title">
          <div class="core-visual">
            <video src="/aster-core-loop.mp4" autoplay muted loop playsinline aria-hidden="true"></video>
          </div>
          <div class="core-copy">
            <p class="brand-label">ASTER LAUNCHER</p>
            <h1 id="hero-title">All your mods.<br>One launcher.</h1>
            <p class="intro">Aster keeps your games, mods and profiles in one place. Simple to set up, easy to manage, and built for more than one game.</p>
            <div class="actions">
              <a class="action" href="/privacy"><span class="arrow" aria-hidden="true">‹</span> Privacy</a>
              <a class="action" href="${REPOSITORY_URL}" rel="noreferrer">GitHub</a>
              <span class="action action-primary" aria-disabled="true">In development</span>
            </div>
          </div>
        </section>
        <a class="scroll-cue" href="#library">Scroll to explore <span aria-hidden="true">↓</span></a>
      </section>

      <section class="content-section" id="library">
        <div class="section-card" data-reveal>
          <header class="section-head">
            <p class="section-number">01 / LIBRARY</p>
            <h2>Everything<br>together.</h2>
            <p>Aster gives every supported game its own space. Your mods, profiles and settings stay where they belong, so switching setups stays simple.</p>
          </header>
          <div class="feature-list">
            <article class="feature"><span class="feature-index">01 / GAMES</span><h3>One clear library.</h3><p>Find every supported game and setup from a single place.</p></article>
            <article class="feature"><span class="feature-index">02 / MODS</span><h3>Mods without the mess.</h3><p>Install and manage content without sorting folders by hand.</p></article>
            <article class="feature"><span class="feature-index">03 / PROFILES</span><h3>Every setup stays separate.</h3><p>Keep different mod collections and settings ready to launch.</p></article>
          </div>
        </div>
      </section>

      <section class="content-section">
        <div class="section-card workflow-card" data-reveal>
          <div class="workflow-copy"><p class="brand-label">02 / YOUR SETUP</p><h2>Built around<br>the way you play.</h2><p>Aster keeps the routine short. Choose a game, shape a profile and get back to playing.</p></div>
          <div class="workflow-list">
            <article class="workflow-item"><span>01</span><div><h3>Start clean.</h3><p>Create a fresh profile for any supported game.</p></div></article>
            <article class="workflow-item"><span>02</span><div><h3>Change freely.</h3><p>Add, remove and organise mods as your setup grows.</p></div></article>
            <article class="workflow-item"><span>03</span><div><h3>Stay in control.</h3><p>See what belongs to each profile before you launch.</p></div></article>
          </div>
        </div>
      </section>

      <section class="content-section closing-section">
        <div class="closing-card" data-reveal>
          <p class="brand-label">ASTER / IN DEVELOPMENT</p>
          <h2>Aster is<br>taking shape.</h2>
          <p>The redesigned launcher is in development. The first public build will arrive when it is ready.</p>
          <div class="closing-actions"><a class="action" href="#content">Back to top</a><a class="action action-primary" href="${REPOSITORY_URL}" rel="noreferrer">Follow on GitHub</a></div>
        </div>
      </section>
      <footer class="site-footer"><span>© 2026 Aster</span><a href="/privacy">Privacy</a><a href="/legal">Legal</a></footer>
    </main>`,
  });
}

function documentPage({ title, subtitle, path, body }) {
  return shell({
    title: `${title} — Aster`,
    description: subtitle,
    path,
    content: `<main class="document-page" id="content"><article class="document-card">
      <header class="document-head"><a href="/">← Back to Aster</a><h1>${title}</h1><p>${subtitle}</p></header>
      <div class="document-content">${body}</div>
    </article></main>`,
  });
}

function privacy() {
  return documentPage({
    title: "Privacy",
    subtitle: "How the Aster website and launcher handle data.",
    path: "/privacy",
    body: `
      <h2>Contact</h2>
      <p><a href="mailto:asterlauncher@gmail.com">asterlauncher@gmail.com</a></p>
      <h2>This website</h2>
      <p>Cloudflare processes the technical data needed to deliver and protect this website, such as your IP address, browser details and the requested page. This website uses no analytics, advertising or optional cookies.</p>
      <h2>The launcher</h2>
      <p>Aster stores profiles, settings, installed content and related game files on your device. There is currently no Aster cloud sync.</p>
      <p>Features such as account sign-in, game ownership checks, mod search and downloads connect to the services you choose to use. These can include Microsoft, Xbox, Minecraft, Modrinth, CurseForge, GitHub and Supabase. Their own privacy terms also apply.</p>
      <h2>Your choices</h2>
      <p>You can remove local launcher data from your device. For privacy questions or requests concerning data controlled by Aster, contact us by email.</p>`,
  });
}

function legal() {
  return documentPage({
    title: "Legal",
    subtitle: "Project information and contact details.",
    path: "/legal",
    body: `
      <h2>Contact</h2>
      <p><a href="mailto:asterlauncher@gmail.com">asterlauncher@gmail.com</a></p>
      <h2>Independent project</h2>
      <p>Aster Launcher is an independent launcher for games and community-made mods. It is not affiliated with or endorsed by the publishers of supported games.</p>
      <h2>Third-party content</h2>
      <p>Games, mods and other community content remain the property of their respective owners. Their licenses and terms apply.</p>
      <h2>Development status</h2>
      <p>The redesigned Aster Launcher is in development. There is currently no public build or installer.</p>`,
  });
}

function retiredPage() {
  return shell({
    title: "Aster — In development",
    description: "The redesigned Aster Launcher is in development.",
    path: "/",
    content: `<main class="retired" id="content"><div><p class="brand-label">ASTER LAUNCHER</p><h1>Nothing to download yet.</h1><p>The new Aster is in development. Public builds will return when the redesigned launcher is ready.</p><a class="action" href="/">Back to Aster</a></div></main>`,
  });
}

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/site.js") {
      return new Response(SITE_JS, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
          ...securityHeaders,
        },
      });
    }

    if (pathname === "/download" || pathname === "/changelog") {
      return new Response(retiredPage(), {
        status: 410,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...securityHeaders,
        },
      });
    }

    const render = { "/": home, "/privacy": privacy, "/legal": legal }[pathname];
    if (!render) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", ...securityHeaders },
      });
    }

    return new Response(render(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        ...securityHeaders,
      },
    });
  },
};
