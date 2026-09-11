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
html{font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;text-rendering:optimizeLegibility}
body{min-height:100vh;overflow-x:hidden}
a{color:inherit}
.skip-link{position:fixed;z-index:30;left:14px;top:14px;padding:10px 14px;background:#fff;color:#000;transform:translateY(-180%)}
.skip-link:focus{transform:none}
.landing{
  position:relative;isolation:isolate;min-height:100svh;display:grid;place-items:center;
  padding:40px 24px 72px;overflow:hidden;background:#030303
}
.ambient-shade{
  position:absolute;z-index:-3;inset:0;background:
    radial-gradient(circle at 50% 46%,rgba(255,255,255,.025),transparent 24rem),
    linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.42))
}
.grid{
  position:absolute;z-index:-2;inset:0;opacity:.5;pointer-events:none;
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
.site-footer{position:absolute;bottom:22px;left:0;right:0;display:flex;justify-content:center;gap:16px;color:#777;font-size:11px}
.site-footer a{text-decoration:none}.site-footer a:hover,.site-footer a:focus-visible{color:#fff}
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
  .document-head,.document-content{padding-left:23px;padding-right:23px}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;transition:none!important}
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
    content: `<main class="landing" id="content">
      <div class="ambient-shade" aria-hidden="true"></div>
      <div class="grid" aria-hidden="true"></div>
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
      <footer class="site-footer"><span>© 2026 Aster</span><a href="/legal">Legal</a></footer>
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
