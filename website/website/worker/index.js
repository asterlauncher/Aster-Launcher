const VERSION = "0.5.1";
const REPOSITORY_URL =
  "https://github.com/asterlauncher/Aster-Launcher";
const RELEASE_URL = `${REPOSITORY_URL}/releases`;
const RELEASE_API_URL =
  "https://api.github.com/repos/asterlauncher/Aster-Launcher/releases?per_page=20";
const FONT_BASE64 = /*__FONT_DATA__*/ "";
const ICON_BASE64 = /*__ICON_DATA__*/ "";
const PREVIEW_BASE64 = /*__PREVIEW_DATA__*/ "";

async function resolveLatestInstaller() {
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Aster-Launcher-Website",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) return null;

    const releases = await response.json();
    if (!Array.isArray(releases)) return null;
    const preferredTag = `app-v${VERSION}`;
    const orderedReleases = [
      ...releases.filter((release) => release?.tag_name === preferredTag),
      ...releases.filter((release) => release?.tag_name !== preferredTag),
    ];
    const assets = orderedReleases.flatMap((release) =>
      Array.isArray(release?.assets) ? release.assets : [],
    );
    const installer =
      assets.find((asset) => /_x64-setup\.exe$/i.test(asset?.name ?? "")) ??
      assets.find((asset) => /\.exe$/i.test(asset?.name ?? "")) ??
      assets.find((asset) => /\.msi$/i.test(asset?.name ?? ""));

    if (typeof installer?.browser_download_url !== "string") return null;
    const download = new URL(installer.browser_download_url);
    return download.protocol === "https:" && download.hostname === "github.com"
      ? {
          name: String(installer.name || `Aster-Launcher-${VERSION}-setup.exe`),
          url: download.href,
        }
      : null;
  } catch {
    return null;
  }
}

const SITE_JS = `
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const stage = document.querySelector(".launcher-stage");
  const shot = stage?.querySelector(".launcher-shot");

  if (stage && shot && finePointer && !reducedMotion) {
    let animationFrame = 0;
    let rotateX = 2;
    let rotateY = 0;
    let scale = 1;

    const renderTilt = () => {
      shot.style.setProperty("--tilt-x", rotateX.toFixed(2) + "deg");
      shot.style.setProperty("--tilt-y", rotateY.toFixed(2) + "deg");
      shot.style.setProperty("--tilt-scale", scale.toFixed(4));
      animationFrame = 0;
    };

    const scheduleTilt = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(renderTilt);
    };

    document.addEventListener("pointermove", (event) => {
      const rect = stage.getBoundingClientRect();
      const proximity = 260;
      const isNear =
        event.clientX >= rect.left - proximity &&
        event.clientX <= rect.right + proximity &&
        event.clientY >= rect.top - proximity &&
        event.clientY <= rect.bottom + proximity;

      stage.classList.toggle("is-near", isNear);
      if (!isNear) {
        rotateX = 2;
        rotateY = 0;
        scale = 1;
        scheduleTilt();
        return;
      }

      const normalizedX = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
      const normalizedY = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)));
      rotateX = 2 - normalizedY * 6;
      rotateY = normalizedX * 8;
      scale = 1.012;
      scheduleTilt();
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
      stage.classList.remove("is-near");
      rotateX = 2;
      rotateY = 0;
      scale = 1;
      scheduleTilt();
    });
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:")) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname === "/download") return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;

    event.preventDefault();
    if (reducedMotion) {
      window.location.assign(destination.href);
      return;
    }
    document.documentElement.classList.add("page-leaving");
    window.setTimeout(() => window.location.assign(destination.href), 260);
  });

  window.addEventListener("pageshow", () => document.documentElement.classList.remove("page-leaving"));
})();
`;

const securityHeaders = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const styles = `
@font-face{font-family:AsterMinecraft;src:url("/minecraft.otf") format("opentype");font-display:swap}
:root{
  color-scheme:dark;--black:#0b0a0d;--rail:#121214;--title:#0e0d10;--panel:#18171a;
  --raised:#1d1c1f;--soft:#151416;--border:#2d2b30;--text:#f6f5f7;
  --muted:#9b969f;--dim:#68636c;--purple:#7840e6;--purple-hi:#9360ff;
  --purple-dark:#3f2472;--green:#71df26;--green-dark:#50b20f
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--black)}
body{
  margin:0;min-width:300px;background:
  radial-gradient(circle at 50% 24%,rgba(120,64,230,.12),transparent 28rem),var(--black);
  color:var(--text);font-family:AsterMinecraft,"Segoe UI",sans-serif;font-size:13px;
  line-height:1.55;text-rendering:optimizeLegibility;overflow-x:hidden
}
body::before{
  content:"";position:fixed;z-index:-1;inset:-20%;pointer-events:none;opacity:.45;
  background:
    radial-gradient(circle at 18% 30%,rgba(147,96,255,.12) 0 1px,transparent 2px),
    radial-gradient(circle at 72% 17%,rgba(113,223,38,.09) 0 1px,transparent 2px),
    radial-gradient(circle at 82% 70%,rgba(147,96,255,.1) 0 1px,transparent 2px);
  background-size:170px 170px,230px 230px,310px 310px;
  animation:spaceDrift 26s linear infinite
}
a{color:inherit}
.nav{
  position:sticky;top:0;z-index:20;height:72px;display:flex;align-items:center;
  border-bottom:1px solid rgba(255,255,255,.07);background:rgba(11,10,13,.94);
  backdrop-filter:blur(14px);animation:navEnter .55s cubic-bezier(.2,.8,.2,1) both
}
.nav-inner,.wrap{width:min(1180px,calc(100% - 48px));margin:0 auto}
.nav-inner{display:flex;align-items:center;gap:28px}
.logo{display:flex;align-items:center;gap:11px;text-decoration:none}
.logo-mark{
  width:36px;height:36px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;
  overflow:hidden;background:#0f0e12
}
.logo-mark img{display:block;width:100%;height:100%;object-fit:cover}
.logo:hover .logo-mark{animation:iconTurn .65s cubic-bezier(.2,.8,.2,1)}
.logo-name{font-size:15px;letter-spacing:.02em}
.nav-links{display:flex;align-items:center;gap:26px;margin-left:auto}
.nav-links a{color:#a9a4ad;text-decoration:none;font-size:11px}
.nav-links a:hover,.nav-links a.active{color:#fff}
.button{
  position:relative;min-height:42px;display:inline-flex;align-items:center;justify-content:center;gap:9px;
  padding:0 19px;border:1px solid #4b4650;background:linear-gradient(#39363d,#29262d);
  color:#fff;text-decoration:none;text-align:center;text-shadow:2px 2px #000;
  box-shadow:inset 0 2px #ffffff17,inset 0 -3px #17151a,0 3px #050407;
  transition:filter .13s,transform .13s;overflow:hidden
}
.button::after{
  content:"";position:absolute;inset:-60% auto -60% -45%;width:35%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.24),transparent);
  transform:skewX(-20deg);transition:left .45s ease
}
.button:hover::after{left:120%}
.button:hover{filter:brightness(1.17)}
.button:active{transform:translateY(2px)}
.button.green{
  border-color:#58be17;background:linear-gradient(#79e32c,#58c20f);
  box-shadow:inset 0 2px #9bf266,inset 0 -4px #358508,0 3px #071504
}
.button.purple{
  border-color:#7840e6;background:linear-gradient(#8950f0,#5d2eb8);
  box-shadow:inset 0 2px #a778ff,inset 0 -4px #3f2472,0 3px #0d0719
}
.hero{min-height:730px;padding:100px 0 0;text-align:center;overflow:hidden}
.kicker{display:block;margin-bottom:19px;color:#a977ff;font-size:10px;letter-spacing:.16em;text-transform:uppercase}
.hero h1,.section-title{
  margin:0 auto;font-size:clamp(42px,7vw,86px);line-height:.98;letter-spacing:-.035em;
  text-shadow:4px 4px #000
}
.hero h1{max-width:970px}
.hero p{max-width:650px;margin:24px auto 0;color:#a7a1ac;font-family:"Segoe UI",sans-serif;font-size:16px;line-height:1.7}
.hero-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:32px}
.tiny{margin-top:13px!important;color:#5f5a63!important;font-size:10px!important;font-family:AsterMinecraft!important}
.hero .kicker{animation:riseIn .55s .08s cubic-bezier(.2,.8,.2,1) both}
.hero h1{animation:riseIn .7s .16s cubic-bezier(.2,.8,.2,1) both}
.hero>div:first-child>p:not(.tiny){animation:riseIn .65s .27s cubic-bezier(.2,.8,.2,1) both}
.hero-actions{animation:riseIn .65s .36s cubic-bezier(.2,.8,.2,1) both}
.hero .tiny{animation:riseIn .55s .44s cubic-bezier(.2,.8,.2,1) both}
.launcher-stage{
  position:relative;width:min(1110px,calc(100% - 20px));margin:68px auto 0;
  padding:0 25px;perspective:1500px;transform-style:preserve-3d;
  animation:launcherStageIn 1s .48s cubic-bezier(.16,.9,.2,1) both
}
.launcher-stage::before,.launcher-stage::after{
  content:"";position:absolute;z-index:-1;left:7%;right:7%;top:8%;bottom:-4%;
  border:1px solid rgba(120,64,230,.22);border-radius:17px;background:#111013;
  transform:translateZ(-55px) translateY(20px) rotateX(3deg);filter:blur(.2px)
}
.launcher-stage::after{
  left:12%;right:12%;top:15%;bottom:-8%;opacity:.45;
  transform:translateZ(-105px) translateY(38px) rotateX(5deg)
}
.launcher-float{transform-style:preserve-3d;animation:launcherFloat 7s 1.45s ease-in-out infinite alternate}
.launcher-shot{
  --tilt-x:2deg;--tilt-y:0deg;--tilt-scale:1;
  position:relative;width:100%;margin:0 auto;transform-style:preserve-3d;
  overflow:hidden;border:1px solid #302d34;border-radius:15px 15px 0 0;background:#0c0b0e;
  box-shadow:0 30px 90px #000,0 0 80px rgba(120,64,230,.12),inset 0 1px #ffffff0b;
  transform:rotateX(var(--tilt-x)) rotateY(var(--tilt-y)) scale(var(--tilt-scale));
  transition:transform .24s cubic-bezier(.2,.8,.2,1),box-shadow .35s,filter .35s;
  will-change:transform
}
.launcher-shot img{display:block;width:100%;height:auto;transform:translateZ(14px);transition:filter .4s}
.launcher-stage.is-near .launcher-float{animation-play-state:paused}
.launcher-stage.is-near .launcher-shot{
  box-shadow:0 48px 110px rgba(0,0,0,.82),0 0 105px rgba(120,64,230,.21),inset 0 1px #ffffff12
}
.launcher-stage.is-near .launcher-shot img{filter:brightness(1.055) saturate(1.04)}
.launcher-shot::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  box-shadow:inset 0 0 0 1px #ffffff08,inset 0 -45px 55px rgba(11,10,13,.32)
}
.section{padding:120px 0}
.section-heading{text-align:center}
.section-title{max-width:850px;font-size:clamp(35px,5.5vw,66px)}
.section-copy{max-width:620px;margin:22px auto 0;color:#8e8892;font-family:"Segoe UI",sans-serif;font-size:15px}
.feature-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:65px;border:1px solid var(--border);background:var(--border)}
.feature-item{
  position:relative;min-height:220px;padding:30px;background:#121114;overflow:hidden;
  transform-style:preserve-3d;transition:transform .32s cubic-bezier(.2,.8,.2,1),background .32s
}
.feature-item::after{
  content:"";position:absolute;width:170px;height:170px;right:-95px;bottom:-105px;
  border:1px solid rgba(120,64,230,.27);transform:rotate(45deg) translateZ(-1px);
  transition:transform .45s,opacity .45s
}
.feature-item:hover{z-index:2;background:#18151c;transform:perspective(750px) rotateX(2.5deg) translateY(-8px)}
.feature-item:hover::after{opacity:1;transform:rotate(57deg) scale(1.15)}
.feature-number{display:block;margin-bottom:45px;color:#7041aa;font-size:11px}
.feature-item h3{margin:0 0 11px;font-size:17px}
.feature-item p{margin:0;color:#817b85;font-family:"Segoe UI",sans-serif;font-size:13px;line-height:1.65}
.links-section{padding:0 0 130px}
.link-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.big-link{
  min-height:235px;display:flex;flex-direction:column;justify-content:space-between;padding:34px;
  overflow:hidden;border:1px solid var(--border);background:
  linear-gradient(145deg,rgba(120,64,230,.12),transparent 52%),#151416;
  text-decoration:none;transform-style:preserve-3d;
  transition:border-color .24s,transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s
}
.big-link:hover{
  border-color:#7840e6;transform:perspective(850px) rotateX(3deg) rotateY(-2deg) translateY(-8px);
  box-shadow:18px 22px 40px rgba(0,0,0,.35),-8px -6px 35px rgba(120,64,230,.09)
}
.big-link:nth-child(2):hover{transform:perspective(850px) rotateX(3deg) rotateY(2deg) translateY(-8px)}
.big-link-top{display:flex;justify-content:space-between;color:#736c78;font-size:10px}
.big-link-arrow{color:#9360ff;font-size:23px}
.big-link h2{margin:0 0 8px;font-size:26px}
.big-link p{margin:0;color:#8f8993;font-family:"Segoe UI",sans-serif;font-size:13px}
.cta{padding:90px 28px;text-align:center;border-top:1px solid #222025;background:#0d0c0f}
.cta h2{max-width:790px;margin:0 auto 27px;font-size:clamp(30px,5vw,58px);line-height:1.05}
.footer{border-top:1px solid #252229;background:#09080a}
.footer-inner{
  width:min(1180px,calc(100% - 48px));margin:0 auto;padding:38px 0;display:flex;
  align-items:flex-start;justify-content:space-between;gap:30px;color:#625d66;font-size:9px
}
.footer-links{display:flex;flex-wrap:wrap;gap:18px}
.footer a{color:#99929d;text-decoration:none}
.footer a:hover{color:#fff}
.document{min-height:calc(100vh - 73px);padding:72px 0 110px}
.document-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:28px}
.document-head h1{margin:0;font-size:clamp(33px,5vw,58px);line-height:1}
.document-head p{margin:12px 0 0;color:#827c86;font-family:"Segoe UI",sans-serif}
.doc-card{padding:clamp(25px,5vw,55px);border:1px solid var(--border);background:#121114}
.doc-card h2{margin:34px 0 10px;padding-bottom:9px;border-bottom:1px solid #2a272d;font-size:18px}
.doc-card h2:first-child{margin-top:0}
.doc-card h3{margin:22px 0 8px;color:#bd92e8;font-size:13px}
.doc-card p,.doc-card li{color:#aaa4ae;font-family:"Segoe UI",sans-serif;font-size:13px;line-height:1.75}
.doc-card a{color:#b77eea}
.notice{margin-bottom:25px;padding:14px;border:1px solid #663697;background:#251730;color:#d5b9e9;font-family:"Segoe UI",sans-serif;font-size:12px}
.release{display:grid;grid-template-columns:110px 1fr;gap:25px;padding:22px 0;border-bottom:1px solid #29262d}
.release:last-child{border:0}
.release-label{color:#a46ee3;font-size:15px}
.release-label small{display:block;margin-top:5px;color:#5f5962;font-size:8px}
.release h2{margin:0 0 8px;padding:0;border:0;font-size:17px}
.page-content{animation:pageEnter .48s cubic-bezier(.2,.8,.2,1) both;transform-origin:50% 8%}
.page-leaving .page-content{animation:pageExit .26s cubic-bezier(.4,0,1,1) both;pointer-events:none}
.page-leaving .nav{transition:opacity .2s;opacity:.72}
@keyframes navEnter{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:none}}
@keyframes riseIn{from{opacity:0;transform:translateY(28px);filter:blur(5px)}to{opacity:1;transform:none;filter:none}}
@keyframes launcherStageIn{
  from{opacity:0;transform:translateY(90px) rotateX(14deg) scale(.9);filter:blur(8px)}
  to{opacity:1;transform:none;filter:none}
}
@keyframes launcherFloat{
  0%{transform:translateY(0)}
  50%{transform:translateY(-8px)}
  100%{transform:translateY(-3px)}
}
@keyframes spaceDrift{to{transform:translate3d(90px,55px,0)}}
@keyframes iconTurn{50%{transform:rotateY(180deg) scale(1.12)}100%{transform:rotateY(360deg)}}
@keyframes scrollReveal{from{opacity:0;transform:translateY(45px)}to{opacity:1;transform:none}}
@keyframes pageEnter{from{opacity:0;transform:translateY(18px) scale(.992);filter:blur(5px)}to{opacity:1;transform:none;filter:none}}
@keyframes pageExit{to{opacity:0;transform:translateY(-13px) scale(.992);filter:blur(4px)}}
@supports(animation-timeline:view()){
  .section-heading,.feature-strip,.big-link,.cta>*{
    animation:scrollReveal linear both;animation-timeline:view();animation-range:entry 5% cover 32%
  }
  .feature-item:nth-child(2){animation-delay:.08s}
  .feature-item:nth-child(3){animation-delay:.16s}
}
@media(max-width:780px){
  .nav-inner,.wrap,.footer-inner{width:min(100% - 28px,620px)}
  .nav-links a:not(.button){display:none}
  .nav-links{gap:8px}.logo-name{font-size:12px}.nav .button{min-height:36px;padding:0 12px;font-size:9px}
  .hero{min-height:650px;padding-top:74px}
  .hero p{font-size:14px}.launcher-stage{width:calc(100% - 8px);margin-top:50px;padding:0 8px}
  .section{padding:90px 0}.feature-strip{grid-template-columns:1fr}.feature-item{min-height:175px}
  .feature-number{margin-bottom:30px}.link-grid{grid-template-columns:1fr}.big-link{min-height:190px}
  .footer-inner{flex-direction:column}.document-head{align-items:flex-start;flex-direction:column}
  .release{grid-template-columns:1fr;gap:9px}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
  .launcher-shot,.feature-item:hover,.big-link:hover,.big-link:nth-child(2):hover{transform:none}
}
`;

function shell({ title, description, path, content }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#0b0a0d">
  <meta name="description" content="${description}">
  <link rel="icon" href="/aster-icon.png" type="image/png">
  <title>${title} · Aster Launcher</title>
  <style>${styles}</style>
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <a class="logo" href="/" aria-label="Aster Launcher Startseite">
        <span class="logo-mark"><img src="/aster-icon.png" alt=""></span><span class="logo-name">ASTER LAUNCHER</span>
      </a>
      <div class="nav-links">
        <a class="${path === "/" ? "active" : ""}" href="/">LAUNCHER</a>
        <a class="${path === "/changelog" ? "active" : ""}" href="/changelog">VERSIONS</a>
        <a class="${path === "/privacy" ? "active" : ""}" href="/privacy">PRIVACY</a>
      </div>
    </div>
  </nav>
  <div class="page-content">
    ${content}
    <footer class="footer">
      <div class="footer-inner">
        <span>© 2026 ASTER LAUNCHER · INDEPENDENT CLOSED ALPHA</span>
        <span>NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</span>
        <span class="footer-links">
          <a href="/legal">IMPRESSUM</a>
          <a href="/privacy">DATENSCHUTZ</a>
          <a href="${REPOSITORY_URL}" rel="noreferrer">GITHUB</a>
        </span>
      </div>
    </footer>
  </div>
  <script src="/site.js" defer></script>
</body>
</html>`;
}

function home() {
  return shell({
    title: "Download",
    description: `Aster Launcher ${VERSION} für Windows herunterladen.`,
    path: "/",
    content: `
      <header class="hero">
        <div class="wrap">
          <span class="kicker">ASTER LAUNCHER · CLOSED ALPHA ${VERSION}</span>
          <h1>YOUR MINECRAFT.<br>YOUR WAY.</h1>
          <p>A fast desktop launcher for Minecraft Java, personal modpacks and community content. Clean, local and fully under your control.</p>
          <div class="hero-actions">
            <a class="button green" href="/download">▶ START PLAYING</a>
            <a class="button" href="#launcher">VIEW LAUNCHER</a>
          </div>
          <p class="tiny">WINDOWS 10/11 · X64 · FREE DOWNLOAD · MINECRAFT JAVA REQUIRED</p>
        </div>
        <div class="launcher-stage">
          <div class="launcher-float">
            <div class="launcher-shot">
              <img src="/launcher-preview.png" alt="Aktuelle Aster Launcher Startseite mit Minecraft-Profil, Accountkarte und News">
            </div>
          </div>
        </div>
      </header>

      <section class="section" id="launcher">
        <div class="wrap">
          <div class="section-heading">
            <span class="kicker">THE LAUNCHER</span>
            <h2 class="section-title">EVERYTHING YOU NEED.<br>NOTHING YOU DON'T.</h2>
            <p class="section-copy">Aster keeps Minecraft instances, mods and updates together without turning your launcher into a social network or a store.</p>
          </div>
          <div class="feature-strip">
            <article class="feature-item">
              <span class="feature-number">01 · INSTANCES</span>
              <h3>YOUR MODPACKS. ISOLATED.</h3>
              <p>Create Vanilla, Fabric and Forge profiles with their own content, worlds and settings.</p>
            </article>
            <article class="feature-item">
              <span class="feature-number">02 · CONTENT</span>
              <h3>INSTALL MODS IN SECONDS.</h3>
              <p>Browse compatible Modrinth and CurseForge releases directly from the launcher.</p>
            </article>
            <article class="feature-item">
              <span class="feature-number">03 · CONTROL</span>
              <h3>LOCAL BY DEFAULT.</h3>
              <p>Your instances stay on your device. No Aster website account and no unnecessary tracking.</p>
            </article>
          </div>
        </div>
      </section>

      <section class="links-section">
        <div class="wrap link-grid">
          <a class="big-link" href="/changelog">
            <span class="big-link-top"><span>01 · RELEASE HISTORY</span><span class="big-link-arrow">↗</span></span>
            <span><h2>VERSIONS</h2><p>See what changed from the first prototype to ${VERSION}.</p></span>
          </a>
          <a class="big-link" href="/privacy">
            <span class="big-link-top"><span>02 · TRANSPARENCY</span><span class="big-link-arrow">↗</span></span>
            <span><h2>DATA &amp; PRIVACY</h2><p>Clear details about local storage, login and external services.</p></span>
          </a>
        </div>
      </section>

      <section class="cta">
        <span class="kicker">READY TO PLAY?</span>
        <h2>DOWNLOAD ASTER LAUNCHER FOR WINDOWS.</h2>
        <a class="button green" href="/download">▶ DOWNLOAD ${VERSION}</a>
      </section>`,
  });
}

function documentPage({ title, subtitle, path, body, action = "" }) {
  return shell({
    title,
    description: subtitle,
    path,
    content: `<main class="document"><div class="wrap">
      <header class="document-head">
        <div><span class="kicker">ASTER LAUNCHER</span><h1>${title}</h1><p>${subtitle}</p></div>
        ${action || '<a class="button" href="/">← BACK</a>'}
      </header>
      <article class="doc-card">${body}</article>
    </div></main>`,
  });
}

function changelog() {
  return documentPage({
    title: `VERSION ${VERSION}`,
    subtitle: "Social Sharing & Public Build Fix",
    path: "/changelog",
    action: `<a class="button green" href="/download">DOWNLOAD ${VERSION}</a>`,
    body: `
      <section class="release">
        <div class="release-label">${VERSION}<small>CURRENT</small></div>
        <div>
          <h2>SOCIAL SHARING &amp; PUBLIC BUILD FIX</h2>
          <ul>
            <li>Eigene Modpacks direkt aus der Bibliothek im Chat auswählen und automatisch exportieren.</li>
            <li>Empfangene Modpacks mit einem Klick in My Modpacks installieren.</li>
            <li>Download-Fortschritt und Installationsfehler direkt im Launcher verfolgen.</li>
            <li>Microsoft-Login, Friends und Presence funktionieren nun in öffentlichen Test-Builds.</li>
          </ul>
          <p><a href="${RELEASE_URL}" rel="noreferrer">Release auf GitHub ansehen →</a></p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.5.0<small>SOCIAL</small></div>
        <div>
          <h2>ASTER SOCIAL</h2>
          <ul>
            <li>Freunde anhand ihres Minecraft-Namens finden und Anfragen senden.</li>
            <li>Private Chats mit Screenshots und Modpack-Dateien.</li>
            <li>Neu gestaltete Benachrichtigungen und Desktop-Hinweise.</li>
            <li>Überarbeitetes Einstellungsmenü mit Speicher-, Präsenz- und Datenschutzoptionen.</li>
          </ul>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.8<small>QUALITY</small></div>
        <div>
          <h2>CLOSED ALPHA QUALITY UPDATE</h2>
          <ul>
            <li>Aktuelle Minecraft-Versionen aus Mojangs Versionsdienst mit zuverlässiger Fallback-Liste.</li>
            <li>Automatische Aktualisierung des aktiven Minecraft-Skins.</li>
            <li>Korrigierter Update-Fortschritt nach einem Neustart des Launchers.</li>
            <li>Einfachere Sortiersteuerung und weitere Launcher-Verbesserungen.</li>
            <li>Aster-Website mit direktem Installer-Download und rechtlichen Informationen.</li>
          </ul>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.7<small>FOUNDATION</small></div>
        <div>
          <h2>CLOSED ALPHA FOUNDATION UPDATE</h2>
          <ul>
            <li>Microsoft- und Minecraft-Anmeldung, Besitzprüfung und Profilanzeige.</li>
            <li>Vanilla-, Fabric- und Forge-Instanzen mit echtem Minecraft-Start.</li>
            <li>Modrinth- und CurseForge-Suche, Downloads und unterstützte Abhängigkeiten.</li>
            <li>Eigene Modpacks erstellen, importieren, exportieren und mit Symbolen versehen.</li>
            <li>Download-Warteschlange, Benachrichtigungen und signierte Launcher-Updates.</li>
            <li>Stabileres Forge-Setup, korrigierter Export und verbesserte Windows-Integration.</li>
          </ul>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.6<small>WINDOWS BUILD</small></div>
        <div>
          <h2>PACKAGING &amp; DISTRIBUTION</h2>
          <p>Windows-Installer, Store-Paketvorbereitung, neue Taskleisten-Symbole und eine überarbeitete Release-Pipeline für reproduzierbare Builds.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.5<small>POLISH</small></div>
        <div>
          <h2>NATIVE WINDOWS POLISH</h2>
          <p>Neues Aster-Symbol, verbesserte Fensterintegration, korrigierte Sidebar-Abstände und stabilere native Hintergrundprozesse.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.4<small>SECURITY</small></div>
        <div>
          <h2>SAFETY &amp; LIVE PRESENCE</h2>
          <p>Anonyme Online-Anzeige, lokale Sicherheitsprüfungen, Microsoft-Defender-Integration und ein echtes Benachrichtigungssystem.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.3<small>SHARING</small></div>
        <div>
          <h2>DOWNLOADS &amp; MODPACK SHARING</h2>
          <p>Download-Center mit Fortschritt, scrollbare Warteschlangen sowie Modpack-Import und -Export zum Teilen eigener Instanzen.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.2<small>FORGE</small></div>
        <div>
          <h2>FORGE SUPPORT</h2>
          <p>Forge-Instanzen, Loader-Installation und zusätzliche Startdiagnosen für inkompatible Java-, Minecraft- und Mod-Konfigurationen.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.1<small>CONTENT</small></div>
        <div>
          <h2>DEPENDENCIES &amp; INSTALL STATE</h2>
          <p>Persistente Installationszustände, automatische unterstützte Mod-Abhängigkeiten, eigene Modpack-Symbole und zuverlässigere Downloads.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.4.0<small>LAUNCH CORE</small></div>
        <div>
          <h2>REAL MINECRAFT LAUNCHING</h2>
          <p>Microsoft-, Xbox- und Minecraft-Anmeldung, Besitzprüfung, Java-Vorbereitung, Spieldateien und der erste echte Minecraft-Start.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.3.0<small>INSTANCES</small></div>
        <div>
          <h2>INSTANCE MANAGEMENT</h2>
          <p>Eigene Vanilla- und Fabric-Instanzen, Inhaltsverwaltung, Welten, Screenshots, Duplizieren, Löschen und lokale Ordner.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.2.0<small>DISCOVERY</small></div>
        <div>
          <h2>MOD &amp; MODPACK DISCOVERY</h2>
          <p>Modrinth- und CurseForge-Suche, Versions- und Loader-Filter, Release-Auswahl, Installationsdialoge und Account-Grundlagen.</p>
        </div>
      </section>
      <section class="release">
        <div class="release-label">0.1.0<small>FIRST BUILD</small></div>
        <div><h2>UI PROTOTYPE</h2><p>Erste Launcher-Oberfläche mit Home, Instanzbibliothek, Entdecken, Downloads, Konten, Einstellungen und dem ursprünglichen Aster-Designsystem.</p></div>
      </section>`,
  });
}

function privacy() {
  return documentPage({
    title: "DATA & PRIVACY",
    subtitle: "Datenschutzhinweise für Website und Desktop-Launcher · Stand 28. Juli 2026",
    path: "/privacy",
    body: `
      <h2>1. KONTAKT</h2>
      <p><strong>E-Mail:</strong> <a href="mailto:asterlauncher@gmail.com">asterlauncher@gmail.com</a></p>
      <h2>2. WEBSITE</h2>
      <p>Beim Aufruf verarbeitet die Hosting-Infrastruktur technisch notwendige Daten wie IP-Adresse, Zeitpunkt, angeforderte Adresse, Browserkennung und Betriebssystem. Das dient Auslieferung, Sicherheit und Fehleranalyse (Art. 6 Abs. 1 lit. f DSGVO).</p>
      <p>Die Website besitzt keine Benutzerkonten, keine Werbung, kein Analytics und keine nicht notwendigen Cookies. Der Download wird über GitHub bereitgestellt; dabei gelten zusätzlich die <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noreferrer">Datenschutzhinweise von GitHub</a>.</p>
      <h2>3. DATEN IM LAUNCHER</h2>
      <h3>LOKALE DATEN</h3>
      <p>Instanzen, Einstellungen, installierte Inhalte, Downloadstatus, Benachrichtigungen, eigene Symbole, Welten und Screenshots werden grundsätzlich auf dem Gerät gespeichert. Es gibt derzeit keine Aster-Cloud-Synchronisierung.</p>
      <h3>MICROSOFT- UND MINECRAFT-ANMELDUNG</h3>
      <p>Die Anmeldung läuft im Systembrowser über Microsoft OAuth 2.0 mit PKCE. Aster erhält niemals das Microsoft-Passwort. Für Anmeldung, Xbox/XSTS-Austausch, Besitzprüfung und Profil werden Microsoft- und Minecraft-Dienste aufgerufen. Dabei werden technische Token, Minecraft-UUID, Benutzername, Besitzstatus und gegebenenfalls Skininformationen verarbeitet. Sitzungstoken werden unter Windows lokal mit DPAPI geschützt.</p>
      <h3>ANONYME ONLINE-ANZEIGE</h3>
      <p>Für die Anzeige geöffneter Launcher wird eine zufällige lokale UUID mit Launcher-Version und Zeitstempel an eine eingeschränkte Supabase-Funktion gesendet. Minecraft-Name, Microsoft-Token, Skin und Gerätename werden nicht in der Präsenz-Tabelle gespeichert. Inaktive Einträge laufen automatisch ab.</p>
      <h2>4. EXTERNE DIENSTE</h2>
      <ul>
        <li>Microsoft, Xbox und Minecraft: Anmeldung, Besitzprüfung, Profil und Spieldateien.</li>
        <li>Modrinth und CurseForge: Suche und Download ausgewählter Community-Inhalte.</li>
        <li>GitHub: Launcher-Downloads und Updates.</li>
        <li>Supabase: anonyme Launcher-Präsenzzählung.</li>
      </ul>
      <p>Beim Verwenden dieser Funktionen können IP-Adresse, Zeitpunkt, Suchbegriffe und ausgewählte Projekt-, Versions- oder Dateikennungen verarbeitet werden. Es gelten zusätzlich die Hinweise der jeweiligen Anbieter. Aster verkauft keine personenbezogenen Daten.</p>
      <h2>5. DAUER, EMPFÄNGER UND RECHTE</h2>
      <p>Lokale Daten bleiben bis zur Löschung durch den Nutzer, Entfernung der Instanz oder Deinstallation erhalten. Präsenzdaten laufen nach kurzer Inaktivität ab. Anbieter können Daten außerhalb des EWR auf Grundlage geeigneter Garantien verarbeiten.</p>
      <p>Betroffene Personen haben nach den gesetzlichen Voraussetzungen Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch und Beschwerde bei einer Aufsichtsbehörde. Bei ausschließlich lokal gespeicherten Daten besitzt Aster keinen Fernzugriff.</p>`,
  });
}

function legal() {
  return documentPage({
    title: "LEGAL",
    subtitle: "Impressum und rechtliche Hinweise",
    path: "/legal",
    body: `
      <h2>KONTAKT</h2>
      <p><strong>E-Mail:</strong> <a href="mailto:asterlauncher@gmail.com">asterlauncher@gmail.com</a></p>
      <h2>UNABHÄNGIGES COMMUNITY-PROJEKT</h2>
      <p>Aster Launcher ist ein unabhängiger Drittanbieter-Launcher und kein offizielles Produkt von Minecraft, Mojang oder Microsoft. Das Projekt wird von Mojang oder Microsoft weder genehmigt, unterstützt noch mit diesen Unternehmen verbunden.</p>
      <p><strong>NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</strong></p>
      <h2>MINECRAFT UND COMMUNITY-INHALTE</h2>
      <p>Aster verkauft oder verteilt Minecraft nicht. Ein separates, rechtmäßig erworbenes Minecraft: Java Edition-Konto ist erforderlich. Mods, Modpacks und Ressourcenpakete stammen von unabhängigen Dritten. Deren Rechte, Lizenzen und Regeln müssen beachtet werden.</p>
      <h2>CLOSED ALPHA</h2>
      <p>Version ${VERSION} ist eine Vorabversion. Fehler, Abstürze, inkompatible Mods oder Datenverluste können nicht ausgeschlossen werden. Vor Änderungen an Instanzen und Welten sollten Sicherungskopien erstellt werden. Gesetzliche Ansprüche bleiben unberührt.</p>
      <p>Cosmetics, Aster Credits und Aster Subscription sind derzeit nur Vorschauen. Über diese Website werden keine Zahlungen angeboten.</p>`,
  });
}

function fontResponse() {
  if (!FONT_BASE64) return new Response("Font is available in built output.", { status: 404 });
  const binary = atob(FONT_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Response(bytes, {
    headers: {
      "content-type": "font/otf",
      "cache-control": "public, max-age=31536000, immutable",
      ...securityHeaders,
    },
  });
}

function pngResponse(base64) {
  if (!base64) return new Response("Image is available in built output.", { status: 404 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      ...securityHeaders,
    },
  });
}

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/download") {
      const installer = await resolveLatestInstaller();
      if (!installer) {
        return new Response(
          "The Aster Launcher installer is temporarily unavailable. Please try again shortly.",
          {
            status: 503,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              ...securityHeaders,
            },
          },
        );
      }

      try {
        const upstream = await fetch(installer.url, {
          redirect: "follow",
          headers: { "user-agent": "Aster-Launcher-Website" },
        });
        if (!upstream.ok || !upstream.body) throw new Error("Installer download failed");

        const safeFilename = installer.name.replace(/["\r\n]/g, "");
        const headers = new Headers({
          "content-type":
            upstream.headers.get("content-type") ?? "application/octet-stream",
          "content-disposition": `attachment; filename="${safeFilename}"`,
          "cache-control": "private, no-store",
          ...securityHeaders,
        });
        const contentLength = upstream.headers.get("content-length");
        if (contentLength) headers.set("content-length", contentLength);
        return new Response(upstream.body, { status: 200, headers });
      } catch {
        return new Response(
          "The Aster Launcher installer could not be downloaded. Please try again shortly.",
          {
            status: 502,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              ...securityHeaders,
            },
          },
        );
      }
    }
    if (pathname === "/minecraft.otf") return fontResponse();
    if (pathname === "/aster-icon.png") return pngResponse(ICON_BASE64);
    if (pathname === "/launcher-preview.png") return pngResponse(PREVIEW_BASE64);
    if (pathname === "/site.js") {
      return new Response(SITE_JS, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
          ...securityHeaders,
        },
      });
    }

    const render = { "/": home, "/changelog": changelog, "/privacy": privacy, "/legal": legal }[pathname];
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
