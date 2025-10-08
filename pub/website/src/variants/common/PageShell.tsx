import React, { useState } from 'react';

type FAQ = { question: string; answer: string };
type FeaturePlan = { name: string; tagline: string; items: string[] };
type PricingPlan = {
  name: string;
  price: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  features: string[];
};

const GALLERY_MEDIA = [
  { gif: '/media/overlay.gif', alt: 'Overlay boundary tree preview' },
  { gif: '/media/ci-pr-comment.gif', alt: 'CI budgets preview' },
  { gif: '/media/report.gif', alt: 'Diagnostics report preview' },
  { gif: '/media/ci-animated.svg', alt: 'Animated CI budgets illustration' },
];

const OUTCOMES: { title: string; description: string }[] = [
  {
    title: 'Stop waterfalls',
    description: 'Parallelize awaits with Promise.all guidance and catch sequential fetches early.',
  },
  {
    title: 'Reduce bundle bloat',
    description: 'Attribute kilobytes to each island so you can split and lazy-load intentionally.',
  },
  {
    title: 'Understand cache & revalidation',
    description: 'See tags, revalidate settings, and conflicts that create stale data.',
  },
  {
    title: 'Measure hydration bottlenecks',
    description: 'Track timings per route and island to prioritize real UX wins.',
  },
];

const HOW_STEPS: { title: string; body: string }[] = [
  {
    title: 'Analyze locally',
    body: 'Run the CLI to generate model.json (server/client graph, diagnostics, suggestions).',
  },
  {
    title: 'Review the report',
    body: 'Open report.html to explore boundaries, Suspense placement, and bytes per island.',
  },
  {
    title: 'Unlock the overlay (Pro)',
    body: 'See live hydration, cache lens, and a Flight timeline; enforce budgets in CI.',
  },
];

const FREE_PLAN: FeaturePlan = {
  name: 'Free · OSS',
  tagline: 'Analyze & report',
  items: [
    'Static analyzer (server/client graph, diagnostics)',
    'Shareable HTML report (boundaries, Suspense, bytes)',
    'CLI for model.json + report.html',
    'Basic Flight tap utilities',
  ],
};

const PRO_PLAN: FeaturePlan = {
  name: 'Pro Overlay & CI',
  tagline: 'Visualize & enforce',
  items: [
    'Live overlay (boundary tree, hydration timings)',
    'Cache lens and revalidation insights',
    'Flight timeline viewer (chunk order, streaming)',
    'CI budgets, PR comments, trend dashboards',
    'VS Code integration & targeted codemods',
  ],
};

const PRICING: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    description: 'Analyzer + HTML report for individuals and open source projects.',
    ctaLabel: 'Install CLI',
    ctaHref: '#install',
    features: [
      'Run the analyzer locally',
      'Shareable HTML report',
      'CLI workflows and schema access',
      'Community support',
    ],
  },
  {
    name: 'Pro',
    price: '$19 per seat · monthly',
    description:
      'Overlay, hydration insights, cache lens, CI budgets, dashboards, priority email support.',
    ctaLabel: 'Buy Pro',
    ctaHref: 'https://rsc-xray.dev/pricing',
    features: [
      'Overlay with hydration + cache views',
      'Flight timeline + Pro scenarios',
      'CI budgets, PR comments, dashboards',
      'Priority email support',
    ],
  },
  {
    name: 'Team',
    price: 'Talk to us',
    description: 'Seat bundles/invoicing, SSO/SCIM roadmap, success pairing, private Slack/Teams.',
    ctaLabel: 'Contact',
    ctaHref: 'mailto:hello@rsc-xray.dev',
    features: [
      'Seat bundles and invoicing',
      'SSO / SCIM roadmap',
      'Customer success pairing',
      'Private Slack/Teams channel',
    ],
  },
];

const TESTIMONIALS = [
  '“Found three route waterfalls on day one. Easy wins.” — Staff Engineer, E-commerce',
  '“Hydration totals changed our priorities — we finally saw where time went.” — Front-end Lead',
  '“The Flight timeline helped explain streaming issues to PMs.” — Web Platform Lead',
];

const TRUST_LOGOS = [
  { src: '/media/logo-next.svg', alt: 'Next.js' },
  { src: '/media/logo-vercel.svg', alt: 'Vercel' },
  { src: '/media/logo-github.svg', alt: 'GitHub' },
];

const PRO_HIGHLIGHTS: { title: string; description: string }[] = [
  {
    title: 'Live Overlay',
    description:
      'Boundary tree with hydration timings, live cache lens, and Flight timeline overlays inside your app.',
  },
  {
    title: 'CI Budgets & Trends',
    description:
      'Gate PRs on client KB, hydration drift, and Flight regressions with out-of-the-box GitHub comments.',
  },
  {
    title: 'Guided Fixes',
    description:
      'Inline remediation tips, codemods, and VS Code integration keep teams unblocked in seconds.',
  },
  {
    title: 'Offline Licensing',
    description:
      'Stripe checkout delivers an offline key so you can unlock Pro without phoning home.',
  },
];

const COMPARISON_POINTS: { title: string; detail: string }[] = [
  {
    title: 'Scope',
    detail:
      'Purpose-built for React Server Components boundaries, Suspense, cache, and Flight rather than generic lint rules.',
  },
  {
    title: 'Speed to Insight',
    detail:
      'Overlay and report visualize waterfalls and hydration bottlenecks without spelunking through logs.',
  },
  {
    title: 'Team Workflow',
    detail:
      'Budgets, PR diffs, and trends give engineering leaders clear guardrails for every release.',
  },
  {
    title: 'Privacy',
    detail:
      'Analyzer runs locally; CI uploads are explicit and opt-in so your code stays on your machines.',
  },
];

const FAQS: FAQ[] = [
  {
    question: 'Which Next.js versions are supported?',
    answer:
      'App Router projects from 13.4 through 15.x. The analyzer runs locally so you control the environment.',
  },
  {
    question: 'Does the analyzer send code to your servers?',
    answer:
      'No. Analyzer and report run locally. Optional CI uploads and metrics are explicit and opt-in.',
  },
  {
    question: 'How do licenses work?',
    answer:
      'Each Pro seat receives a license key. Set it in your environment to unlock overlay and CI packages. Team bundles and invoicing available by request.',
  },
  {
    question: 'Can I try Pro features before buying?',
    answer:
      'Yes. The live demo includes Pro previews and sample overlays so you can see hydration and cache insights before upgrading.',
  },
];

type Props = { hero: React.ReactNode; rootClass?: string };

export function PageShell({ hero, rootClass }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={rootClass}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="logo" href="#hero">
            RSC-Xray
          </a>
          <button
            className="menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMenuOpen((o) => !o)}
          >
            Menu
          </button>
          <nav
            id="primary-nav"
            className={`nav ${menuOpen ? 'is-open' : ''}`}
            aria-label="Primary navigation"
          >
            <ul>
              {[
                { label: 'Demo', href: '#demo' },
                { label: 'Features', href: '#features' },
                { label: 'Pricing', href: '#pricing' },
                { label: 'FAQ', href: '#faq' },
                { label: 'Docs', href: 'https://github.com/rsc-xray/rsc-xray#readme' },
              ].map((link) => (
                <li key={link.label}>
                  <a href={link.href} onClick={closeMenu}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main">
        {hero}

        <section className="in-action" id="gallery">
          <div className="container">
            <h2>In Action</h2>
            <p>A quick look at the overlay, CI budgets, and the shareable report.</p>
            <div className="gallery">
              {GALLERY_MEDIA.map(({ gif, alt }) => (
                <figure key={alt}>
                  <img src={gif} alt={alt} loading="lazy" decoding="async" />
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="trust" id="trust">
          <div className="container trust-inner">
            <span className="trust-label">Trusted by teams using</span>
            <ul className="trust-logos">
              {TRUST_LOGOS.map((logo) => (
                <li key={logo.alt}>
                  <img src={logo.src} alt={logo.alt} loading="lazy" decoding="async" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="outcomes" id="outcomes">
          <div className="container">
            <h2>Why Teams Use RSC-Xray</h2>
            <div className="grid four">
              {OUTCOMES.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="how" id="how">
          <div className="container">
            <h2>How It Works</h2>
            <div className="grid three">
              {HOW_STEPS.map((s) => (
                <article key={s.title}>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
            <div className="cta-center">
              <a className="button primary" href="https://demo.rsc-xray.dev#demo">
                Open the demo
              </a>
            </div>
          </div>
        </section>

        <section className="pro" id="pro">
          <div className="container">
            <h2>Why Teams Upgrade to Pro</h2>
            <div className="grid four">
              {PRO_HIGHLIGHTS.map((i) => (
                <article key={i.title}>
                  <h3>{i.title}</h3>
                  <p>{i.description}</p>
                </article>
              ))}
            </div>
            <div className="cta-center">
              <a className="button primary" href="https://rsc-xray.dev/pricing">
                View Pro pricing
              </a>
              <a className="button secondary" href="https://demo.rsc-xray.dev#pro">
                Preview Pro overlay
              </a>
            </div>
          </div>
        </section>

        <section className="features" id="features">
          <div className="container">
            <h2>What’s Included</h2>
            <div className="grid two">
              {[FREE_PLAN, PRO_PLAN].map((plan) => (
                <article key={plan.name}>
                  <h3>{plan.name}</h3>
                  <p className="plan-tagline">{plan.tagline}</p>
                  <ul>
                    {plan.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="comparison" id="compare">
          <div className="container">
            <h2>Why Not Just Use Generic Tools?</h2>
            <div className="grid two">
              {COMPARISON_POINTS.map((p) => (
                <article key={p.title}>
                  <h3>{p.title}</h3>
                  <p>{p.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pricing" id="pricing">
          <div className="container">
            <h2>Pricing</h2>
            <div className="grid three">
              {PRICING.map((plan) => (
                <article key={plan.name}>
                  <h3>{plan.name}</h3>
                  <p className="plan-price">{plan.price}</p>
                  <p>{plan.description}</p>
                  <ul>
                    {plan.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <a className="button primary" href={plan.ctaHref}>
                    {plan.ctaLabel}
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="testimonials" id="proof">
          <div className="container">
            <h2>What Teams Say</h2>
            <div className="grid three">
              {TESTIMONIALS.map((q) => (
                <blockquote key={q}>{q}</blockquote>
              ))}
            </div>
          </div>
        </section>

        <section className="faq section-muted" id="faq">
          <div className="container faq-grid">
            <div>
              <h2>Frequently Asked Questions</h2>
              <p>
                Still unsure? Reach us at <a href="mailto:hello@rsc-xray.dev">hello@rsc-xray.dev</a>
                .
              </p>
              <ul className="faq-bullets">
                <li>Analyzer + report run locally by default</li>
                <li>CI uploads and telemetry are opt-in</li>
                <li>Licenses unlock Pro packages instantly</li>
              </ul>
            </div>
            <div className="faq-accordion" role="tablist">
              {FAQS.map((faq, index) => {
                const isActive = index === activeFaq;
                const triggerId = `faq-trigger-${index}`;
                const panelId = `faq-panel-${index}`;
                return (
                  <div key={faq.question} className={`faq-item${isActive ? ' is-active' : ''}`}>
                    <button
                      type="button"
                      aria-expanded={isActive}
                      aria-controls={panelId}
                      id={triggerId}
                      className="faq-trigger"
                      onClick={() => setActiveFaq(isActive ? null : index)}
                    >
                      <span>{faq.question}</span>
                      <span className="faq-icon" aria-hidden>
                        {isActive ? '−' : '+'}
                      </span>
                    </button>
                    <div
                      className="faq-panel"
                      id={panelId}
                      role="region"
                      aria-labelledby={triggerId}
                      hidden={!isActive}
                    >
                      <p>{faq.answer}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="newsletter section-accent" id="email">
          <div className="container newsletter-inner">
            <div>
              <p className="eyebrow eyebrow-light">Launch updates · No spam</p>
              <h2>Get RSC teardowns and release notes</h2>
              <p className="lead">
                One or two emails per month. We share release highlights, deep dives on hydration
                and cache wins, and launch resources before public announcements.
              </p>
              <ul className="newsletter-points">
                <li>Early access to blog posts and docs</li>
                <li>Release highlights with upgrade notes</li>
                <li>Playbooks for CI budgets and overlays</li>
              </ul>
            </div>
            <form className="newsletter-form">
              <div className="newsletter-card">
                <label htmlFor="newsletter-name">Name</label>
                <input id="newsletter-name" type="text" name="name" placeholder="Ada Lovelace" />
                <label htmlFor="newsletter-email">Work email*</label>
                <input
                  id="newsletter-email"
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                />
                <button className="button primary" type="submit">
                  Notify me
                </button>
                <small>
                  By subscribing you consent to occasional updates from RSC-Xray (≤2 per month).
                  Unsubscribe any time.
                </small>
              </div>
            </form>
          </div>
        </section>
      </main>

      <footer className="site-footer" id="contact">
        <div className="container footer-inner">
          <div>
            <h3>Product</h3>
            <ul>
              <li>
                <a href="https://demo.rsc-xray.dev">Live demo</a>
              </li>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#pricing">Pricing</a>
              </li>
              <li>
                <a href="https://github.com/rsc-xray/rsc-xray#readme">Docs</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li>
                <a href="https://rsc-xray.dev/blog">Blog</a>
              </li>
              <li>
                <a href="https://rsc-xray.dev/changelog">Changelog</a>
              </li>
              <li>
                <a href="https://status.rsc-xray.dev">Status</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Legal</h3>
            <ul>
              <li>
                <a href="https://rsc-xray.dev/privacy">Privacy</a>
              </li>
              <li>
                <a href="https://rsc-xray.dev/terms">Terms</a>
              </li>
              <li>
                <a href="https://github.com/rsc-xray/rsc-xray/blob/main/LICENSE">License</a>
              </li>
            </ul>
          </div>
        </div>
        <p className="footer-credit">
          © {new Date().getFullYear()} RSC-Xray. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

export default PageShell;
