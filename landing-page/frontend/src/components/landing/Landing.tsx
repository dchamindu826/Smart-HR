'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { SITE, whatsappLink } from '@/lib/site';
import { features, featuresHead, fill, plans, plansHead, type IconName, type Lang } from './content';
import './landing.css';

// ─── small pieces ──────────────────────────────────────────────

const ICONS: Record<IconName, ReactNode> = {
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17M8 14h3M8 17h6" /></>,
  leaf: <><path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" /><path d="M5 19c3-4 6-6.5 10-8.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /><path d="M17.5 3.5l3 3" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 9.5h18M6 6l9-3 1.5 3" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6L12 3Z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  coins: <><ellipse cx="9" cy="7" rx="5.5" ry="2.5" /><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5S14.5 12.4 14.5 11V7" /><path d="M9.5 15.5c.9 1.2 3 2 5.5 2 3 0 5.5-1.1 5.5-2.5v-4c0-1.4-2.5-2.5-5.5-2.5" /></>,
  megaphone: <><path d="M4 10v4h3l7 4.5v-13L7 10H4Z" /><path d="M17.5 9a4 4 0 0 1 0 6M7 14l1 5h2.5" /></>,
  laptop: <><rect x="4.5" y="5" width="15" height="10" rx="1.5" /><path d="M2.5 18.5h19" /></>,
  branches: <><circle cx="6" cy="5.5" r="2.2" /><circle cx="18" cy="5.5" r="2.2" /><circle cx="12" cy="18.5" r="2.2" /><path d="M6 7.7v2.3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.7M12 12v4.3" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3M20 16V6" /></>,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

function WhatsAppIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

/** Adds .in when the element scrolls into view (one time). */
function useReveal(dep: unknown) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.lp [data-reveal]:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

const WORDS = ['attendance', 'rosters', 'leave', 'payroll', 'EPF & ETF'];

function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="lp-rotate" aria-live="polite">
      <span key={i} className="lp-word">{WORDS[i]}</span>
    </span>
  );
}

function LangSwitch({ lang, setLang, compact }: { lang: Lang; setLang: (l: Lang) => void; compact?: boolean }) {
  return (
    <div className={`lp-lang${compact ? ' compact' : ''}`} role="group" aria-label="Language">
      <span className="lp-lang-pill" style={{ transform: lang === 'si' ? 'translateX(100%)' : 'none' }} />
      <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>English</button>
      <button type="button" className={`si${lang === 'si' ? ' on' : ''}`} onClick={() => setLang('si')} aria-pressed={lang === 'si'} lang="si">සිංහල</button>
    </div>
  );
}

/** The phone in the hero: a live clock and a mark-in dial. */
function PhoneMock() {
  const [now, setNow] = useState<string>('08:29');
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }).format(new Date()));
    tick();
    const t = setInterval(tick, 20_000);
    const m = setInterval(() => setMarked((x) => !x), 3600);
    return () => {
      clearInterval(t);
      clearInterval(m);
    };
  }, []);
  return (
    <div className="lp-phone" aria-hidden>
      <div className="lp-phone-notch" />
      <div className="lp-phone-screen">
        <div className="lp-ph-top">
          <span>{now}</span>
          <span className="lp-ph-dots"><i /><i /><i /></span>
        </div>
        <div className="lp-ph-hello">Good morning,<b>Kamal</b></div>
        <div className="lp-ph-seg"><span className="on">Office</span><span>Remote</span></div>
        <div className={`lp-dial${marked ? ' done' : ''}`}>
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="lpg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#e40675" />
                <stop offset=".5" stopColor="#c810b0" />
                <stop offset="1" stopColor="#0b6fd4" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="50" className="track" />
            <circle cx="60" cy="60" r="50" className="arc" />
          </svg>
          <div className="lp-dial-in">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 11v4M8.5 8.8a5 5 0 0 1 8.5 3.2v1.5M7 12c0 3 .8 5 2.2 7M12 6a7 7 0 0 1 7 7v1M5 13.5V12a7 7 0 0 1 2-4.9M15.5 15.5c-.2 1.8-.8 3.3-1.6 4.5" /></svg>
            <b>{marked ? 'Marked in' : 'Mark in'}</b>
            <small>{marked ? `${now} · Head office` : 'Tap to start'}</small>
          </div>
        </div>
        <div className="lp-ph-tiles">
          <div><small>Leave left</small><b>11.5</b></div>
          <div><small>This week</small><b>32 h</b></div>
        </div>
        <div className="lp-ph-nav"><i className="on" /><i /><i /><i /></div>
      </div>
    </div>
  );
}

// ─── the page ──────────────────────────────────────────────────

const FAQ: { q: Record<Lang, string>; a: Record<Lang, string> }[] = [
  {
    q: {
      en: 'Do my staff need to buy anything?',
      si: 'මගේ සේවකයින් කිසිවක් මිලදී ගත යුතුද?',
    },
    a: {
      en: 'No. Staff use the free SmartHR app on their own iPhone or Android phone. You can also connect fingerprint or face terminals on the Complete plan.',
      si: 'නැත. සේවකයින් ඔවුන්ගේම iPhone හෝ Android දුරකථනයෙන් නොමිලේ SmartHR ඇප් එක භාවිතා කරයි. Complete සැලසුමෙන් fingerprint හෝ face terminals ද සම්බන්ධ කළ හැක.',
    },
  },
  {
    q: {
      en: 'Is EPF, ETF and APIT included?',
      si: 'EPF, ETF සහ APIT ඇතුළත්ද?',
    },
    a: {
      en: 'Yes, in every plan. SmartHR works out EPF (8% employee, 12% employer), ETF (3%) and APIT each month and prepares the return files and the bank transfer file.',
      si: 'ඔව්, සෑම සැලසුමකම ඇතුළත් වේ. SmartHR මඟින් සෑම මසකම EPF (8% සේවක, 12% සේවායෝජක), ETF (3%) සහ APIT ගණනය කර, අදාළ වාර්තා (returns) සහ බැංකු ගෙවීම් ලිපිගොනු (bank transfer files) සකස් කර දෙයි.',
    },
  },
  {
    q: {
      en: 'How long does it take to start?',
      si: 'ආරම්භ කිරීමට කොපමණ කාලයක් ගතවේද?',
    },
    a: {
      en: 'Most small companies are running within a few days. Send us your staff list in Excel and we help you import it, set up shifts and leave, and train your HR team.',
      si: 'බොහෝ ආයතන දින කිහිපයක් ඇතුළත ක්‍රියාත්මක වේ. ඔබේ සේවක ලැයිස්තුව Excel මඟින් අපට ලබා දෙන්න. අපි එය import කර, shifts, leave සකසා, ඔබේ HR කණ්ඩායම පුහුණු කිරීමට සහාය දෙන්නෙමු.',
    },
  },
  {
    q: {
      en: 'Is our data safe?',
      si: 'අපගේ දත්ත සුරක්ෂිතද?',
    },
    a: {
      en: 'Data is encrypted in transit, passwords are never stored in readable form, and every change to payroll and attendance is logged. Each company only ever sees its own data.',
      si: 'සියලුම දත්ත HTTPS මඟින් encrypt කර ඇත. මුරපද කිසි විටෙකත් කියවිය හැකි ආකාරයෙන් ගබඩා නොකෙරේ. වැටුප් හා පැමිණීම් වල සෑම වෙනස්කමක්ම log සටහන් වේ. සෑම ආයතනයකටම දැකිය හැක්කේ තම ආයතනයේ දත්ත පමණි.',
    },
  },
  {
    q: {
      en: 'Can I try it first?',
      si: 'පළමුව අත්හදා බැලිය හැකිද?',
    },
    a: {
      en: 'Yes. Message us on WhatsApp and we will show you a live demo with sample data, then set up a trial for your company.',
      si: 'ඔව්. WhatsApp මඟින් අප අමතන්න. අපි sample දත්ත සමඟ live demo එකක් පෙන්වා, ඔබේ ආයතනයට නොමිලේ trial එකක් සකසා දෙන්නෙමු.',
    },
  },
];

export function Landing() {
  const [lang, setLangState] = useState<Lang>('en');
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<number | null>(0);
  const [currentPlans, setCurrentPlans] = useState(plans);
  const spot = useRef<HTMLDivElement>(null);
  useReveal(lang);

  // Fetch active plans from the admin panel to keep prices in sync
  useEffect(() => {
    fetch('/api/v1/platform/plans/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { code: string; name: string; priceMonthly: string; priceYearly: string | null; maxEmployees: number }[] | null) => {
        if (!data || !Array.isArray(data)) return;
        setCurrentPlans((prev) =>
          prev.map((p) => {
            const apiMatch = data.find((d) => d.code.toLowerCase() === p.name.toLowerCase() || d.name.toLowerCase() === p.name.toLowerCase());
            if (!apiMatch) return p;
            const pm = Number(apiMatch.priceMonthly);
            const py = apiMatch.priceYearly ? Number(apiMatch.priceYearly) : pm * 10;
            return {
              ...p,
              max: apiMatch.maxEmployees || p.max,
              price: !isNaN(pm) && pm > 0 ? pm.toLocaleString('en-LK') : p.price,
              year: !isNaN(py) && py > 0 ? py.toLocaleString('en-LK') : p.year,
            };
          })
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sh-lp-lang');
      if (saved === 'si' || saved === 'en') setLangState(saved);
    } catch {}
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('sh-lp-lang', l);
    } catch {}
  };

  // a soft light that follows the pointer over the feature grid
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = spot.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const wa = whatsappLink();
  const nav = [
    ['#features', 'Features'],
    ['#how', 'How it works'],
    ['#plans', 'Plans'],
    ['#faq', 'FAQ'],
    ['#contact', 'Contact'],
  ];

  return (
    <div className="lp" data-lang={lang}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400;500;600;700&display=swap" precedence="default" />

      {/* ── nav ── */}
      <header className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <a href="#top" className="lp-brand" aria-label="SmartHR home"><img src="/logo.png" alt="SmartHR by Lumi AI" /></a>
          <nav className={`lp-links${menu ? ' open' : ''}`} onClick={() => setMenu(false)}>
            {nav.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
            <Link href="/login" className="lp-links-login">Log in</Link>
          </nav>
          <div className="lp-nav-cta">
            <LangSwitch lang={lang} setLang={setLang} compact />
            <Link href="/login" className="lp-btn ghost sm hide-sm">Log in</Link>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn sm hide-sm">Get a demo</a>
            <button className={`lp-burger${menu ? ' open' : ''}`} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><span /><span /></button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ── hero ── */}
        <section className="lp-hero">
          <div className="lp-blobs" aria-hidden><i className="b1" /><i className="b2" /><i className="b3" /></div>
          <div className="lp-grid-bg" aria-hidden />
          <div className="lp-wrap lp-hero-in">
            <div className="lp-hero-copy">
              <span className="lp-badge" data-reveal><span className="dot" /> Made in Sri Lanka, for Sri Lankan businesses</span>
              <h1 data-reveal style={{ ['--d' as string]: '80ms' }}>
                HR made simple, <br />
                from <RotatingWord /> <br className="hide-sm" />to payslips.
              </h1>
              <p className="lp-lead" data-reveal style={{ ['--d' as string]: '160ms' }}>
                SmartHR brings attendance, rosters, leave, overtime and payroll with EPF, ETF and APIT into one simple system — with a mobile app your staff will actually use.
              </p>
              <div className="lp-hero-cta" data-reveal style={{ ['--d' as string]: '240ms' }}>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lg wa"><WhatsAppIcon /> Chat on WhatsApp</a>
                <a href="#features" className="lp-btn lg ghost">See features <span aria-hidden>→</span></a>
              </div>
              <ul className="lp-ticks" data-reveal style={{ ['--d' as string]: '320ms' }}>
                <li>Free demo</li>
                <li>Quick setup</li>
                <li>Sinhala &amp; English support</li>
              </ul>
            </div>

            <div className="lp-hero-art" data-reveal style={{ ['--d' as string]: '200ms' }}>
              <div className="lp-ring" aria-hidden />
              <PhoneMock />
              <div className="lp-float f1" aria-hidden>
                <span className="ic ok">✓</span>
                <div><b>Leave approved</b><small>Nimali · 2 days annual</small></div>
              </div>
              <div className="lp-float f2" aria-hidden>
                <span className="ic grad">Rs</span>
                <div><b>Payroll ready</b><small>EPF · ETF · APIT done</small></div>
              </div>
              <div className="lp-float f3" aria-hidden>
                <span className="ic blue">⌖</span>
                <div><b>Remote · GPS ok</b><small>Kasun marked in 08:57</small></div>
              </div>
            </div>
          </div>

          <div className="lp-marquee" aria-hidden>
            <div className="lp-marquee-track">
              {[0, 1].map((k) => (
                <div key={k} className="lp-marquee-row">
                  {['GPS attendance', 'Night shifts', 'Leave balances', 'Overtime limit', 'EPF 8% + 12%', 'ETF 3%', 'APIT', 'Payslip PDF', 'Bank file', 'Gratuity', 'Fingerprint terminals', 'Face check', 'Multi-branch', 'Offline punches'].map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── facts ── */}
        <section className="lp-facts lp-wrap">
          {[
            ['8% + 12%', 'EPF worked out for you'],
            ['3%', 'ETF every month'],
            ['1 tap', 'mark in from the phone'],
            ['0', 'spreadsheets at month end'],
          ].map(([n, t], i) => (
            <div key={t} className="lp-fact" data-reveal style={{ ['--d' as string]: `${i * 80}ms` }}>
              <b>{n}</b>
              <span>{t}</span>
            </div>
          ))}
        </section>

        {/* ── features (English / Sinhala) ── */}
        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker" lang={lang}>{featuresHead.kicker[lang]}</span>
              <h2 lang={lang}>{featuresHead.title[lang]}</h2>
              <p lang={lang}>{featuresHead.text[lang]}</p>
              <LangSwitch lang={lang} setLang={setLang} />
            </div>
            <div className="lp-features" ref={spot} onMouseMove={onMove} key={lang}>
              {features.map((f, i) => (
                <article key={f.icon} className="lp-feature" data-reveal style={{ ['--d' as string]: `${(i % 3) * 70}ms` }}>
                  <span className="lp-feature-ic"><Icon name={f.icon} /></span>
                  <h3 lang={lang}>{f.title[lang]}</h3>
                  <p lang={lang}>{f.text[lang]}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── console preview ── */}
        <section className="lp-section lp-showcase">
          <div className="lp-wrap lp-show-in">
            <div className="lp-show-copy" data-reveal>
              <span className="lp-kicker">The HR console</span>
              <h2>See your whole company on one screen</h2>
              <p>Who is in, who is late, who is on leave and what is waiting for approval — live, for every branch. Close the month and run payroll without a single spreadsheet.</p>
              <ul className="lp-checks">
                <li>Live attendance board for every branch</li>
                <li>Approvals for leave, overtime and corrections</li>
                <li>Payroll with a full audit trail, locked once approved</li>
                <li>Org chart, documents and employee history</li>
              </ul>
            </div>
            <div className="lp-bento" data-reveal style={{ ['--d' as string]: '120ms' }} aria-hidden>
              <div className="bt big">
                <small>Present today</small>
                <b className="count">42<span>/45</span></b>
                <div className="bars">{[60, 80, 72, 90, 85, 95, 93].map((h, i) => <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />)}</div>
              </div>
              <div className="bt"><small>Late</small><b>3</b><em className="warn">Need review</em></div>
              <div className="bt"><small>On leave</small><b>2</b><em className="mag">Annual · medical</em></div>
              <div className="bt grad wide">
                <small>October payroll</small>
                <b>Ready to approve</b>
                <div className="pay"><span>Gross Rs 3.2M</span><span>EPF + ETF Rs 0.48M</span></div>
              </div>
              <div className="bt"><small>Pending approvals</small><b>5</b><em className="blue">Leave · OT</em></div>
              <div className="bt"><small>Payslips</small><b>45</b><em className="blue">Sent to the app</em></div>
            </div>
          </div>
        </section>

        {/* ── how ── */}
        <section id="how" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker">How it works</span>
              <h2>Up and running in three steps</h2>
            </div>
            <ol className="lp-steps">
              {[
                ['Talk to us', 'Message us on WhatsApp. We show you a live demo and answer every question about your company’s setup.'],
                ['We set it up', 'Send your staff list in Excel. We import it, set your shifts, leave rules and salary components, and train your HR team.'],
                ['Your staff download the app', 'Everyone signs in with the login you give them and starts marking attendance the same day.'],
              ].map(([t, d], i) => (
                <li key={t} data-reveal style={{ ['--d' as string]: `${i * 110}ms` }}>
                  <span className="n">{i + 1}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── plans (English / Sinhala) ── */}
        <section id="plans" className="lp-section lp-plans-sec">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker" lang={lang}>{plansHead.kicker[lang]}</span>
              <h2 lang={lang}>{plansHead.title[lang]}</h2>
              <p lang={lang}>{plansHead.text[lang]}</p>
              <LangSwitch lang={lang} setLang={setLang} />
            </div>
            <div className="lp-plans" key={lang}>
              {currentPlans.map((p, i) => (
                <div key={p.name} className={`lp-plan${p.popular ? ' popular' : ''}`} data-reveal style={{ ['--d' as string]: `${i * 90}ms` }}>
                  {p.popular && <span className="lp-plan-tag" lang={lang}>★ {plansHead.popular[lang]}</span>}
                  <h3>{p.name}</h3>
                  <p className="lp-plan-max" lang={lang}>{fill(plansHead.employees[lang], { n: p.max })}</p>
                  <div className="lp-price"><small>Rs</small>{p.price}<span lang={lang}>{plansHead.month[lang]}</span></div>
                  <p className="lp-plan-year" lang={lang}>{fill(plansHead.year[lang], { y: p.year })}</p>
                  <ul>{p.items.map((it) => <li key={it.en} lang={lang}>{it[lang]}</li>)}</ul>
                  <a href={whatsappLink(`Hi Lumi Automation, I am interested in the SmartHR ${p.name} plan.`)} target="_blank" rel="noopener noreferrer" className={`lp-btn ${p.popular ? '' : 'ghost'} block`} lang={lang}>
                    {plansHead.demo[lang]}
                  </a>
                </div>
              ))}
            </div>
            <p className="lp-note">Prices in Sri Lankan rupees. Need more than 500 employees? <a href={wa} target="_blank" rel="noopener noreferrer">Talk to us</a>.</p>
          </div>
        </section>

        {/* ── app ── */}
        <section className="lp-section">
          <div className="lp-wrap lp-app" data-reveal>
            <div>
              <span className="lp-kicker light">Employee app</span>
              <h2>Your staff carry HR in their pocket</h2>
              <p>Mark in and out, see the roster, apply for leave, explain overtime and open payslips — on iPhone and Android. Location is read only when staff press Mark in or Mark out.</p>
              <div className="lp-stores">
                <span className="lp-store"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16.4 12.6c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.7-1-2.7-4.3ZM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4Z" /></svg><span><small>Coming soon on the</small>App Store</span></span>
                <span className="lp-store"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 2.6c-.3.3-.4.7-.4 1.2v16.4c0 .5.1.9.4 1.2l9.1-9.4L4 2.6Zm10.3 9.4 2.7 2.8-11.5 6.6 8.8-9.4Zm0 0L5.5 2.6 17 9.2 14.3 12Zm3.9-2.1 3 1.7c.9.5.9 1.3 0 1.8l-3 1.7-2.9-3.1 2.9-2.1Z" /></svg><span><small>Coming soon on</small>Google Play</span></span>
              </div>
            </div>
            <div className="lp-app-art" aria-hidden><PhoneMock /></div>
          </div>
        </section>

        {/* ── faq ── */}
        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-faq-wrap">
            <div className="lp-head left" data-reveal>
              <span className="lp-kicker">FAQ</span>
              <h2 lang={lang}>{lang === 'si' ? 'නිතර අසන ප්‍රශ්න' : 'Questions we hear a lot'}</h2>
              <p lang={lang}>
                {lang === 'si'
                  ? 'වෙනත් ප්‍රශ්න තිබේද? WhatsApp මඟින් අපෙන් විමසන්න — වැඩකරන දිනවලදී අප පිළිතුරු ලබා දෙන්නෙමු.'
                  : 'Anything else? Ask us on WhatsApp — we reply on Sri Lankan working days.'}
              </p>
            </div>
            <div className="lp-faq" data-reveal>
              {FAQ.map((f, i) => (
                <div key={f.q.en} className={`lp-q${open === i ? ' open' : ''}`}>
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    <span lang={lang}>{f.q[lang]}</span>
                    <span className="pm" aria-hidden />
                  </button>
                  <div className="lp-a"><div><p lang={lang}>{f.a[lang]}</p></div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── contact ── */}
        <section id="contact" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-contact" data-reveal>
              <div className="lp-blobs small" aria-hidden><i className="b1" /><i className="b2" /></div>
              <div className="lp-contact-copy">
                <h2>Ready to stop chasing timesheets?</h2>
                <p>Message us on WhatsApp for a free demo. We will show you SmartHR with your own shifts and salary structure.</p>
                <div className="lp-hero-cta">
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lg wa"><WhatsAppIcon /> WhatsApp {SITE.phoneDisplay}</a>
                  <a href={`mailto:${SITE.email}?subject=${encodeURIComponent('SmartHR demo')}`} className="lp-btn lg glass">Email us</a>
                </div>
              </div>
              <div className="lp-contact-cards">
                <a href={wa} target="_blank" rel="noopener noreferrer"><span className="ic wa"><WhatsAppIcon size={20} /></span><div><small>WhatsApp</small><b>{SITE.phoneDisplay}</b></div></a>
                <a href={`mailto:${SITE.email}`}><span className="ic">@</span><div><small>Email</small><b>{SITE.email}</b></div></a>
                <div><span className="ic">⌂</span><div><small>Office</small><b>{SITE.address}</b></div></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── footer ── */}
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-foot-brand">
            <img src="/logo.png" alt="SmartHR by Lumi AI" />
            <p>HR, attendance and payroll for Sri Lankan businesses. A product of {SITE.company}.</p>
          </div>
          <div className="lp-foot-cols">
            <div>
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#plans">Plans</a>
              <Link href="/login">Log in</Link>
            </div>
            <div>
              <h4>Company</h4>
              <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a href={`mailto:${SITE.email}`}>Email</a>
              <Link href="/support">Support</Link>
            </div>
            <div>
              <h4>Legal</h4>
              <Link href="/terms">Terms and conditions</Link>
              <Link href="/privacy">Privacy policy</Link>
            </div>
          </div>
        </div>
        <div className="lp-wrap lp-foot-bottom">
          <span>© {new Date().getFullYear()} {SITE.company}. All rights reserved.</span>
          <span><Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></span>
        </div>
      </footer>

      <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-wa-fab" aria-label="Chat with us on WhatsApp"><WhatsAppIcon size={28} /></a>
    </div>
  );
}
