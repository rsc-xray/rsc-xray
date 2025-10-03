import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';

const INSTALL_COMMAND =
  'npm i -D @rsc-xray/cli && npx @rsc-xray/cli analyze --project . --out model.json && npx @rsc-xray/cli report --model model.json --out report.html';

type Particle = {
  left: string;
  top: string;
  duration: string;
  delay: string;
  opacity: number;
};

const PARTICLE_COUNT = 18;

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }).map(() => ({
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    duration: `${12 + Math.random() * 16}s`,
    delay: `${Math.random() * 6}s`,
    opacity: Number((0.15 + Math.random() * 0.25).toFixed(2)),
  }));
}

export default function Hero() {
  const particles = useMemo(createParticles, []);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = INSTALL_COMMAND;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyError(false);
      setCopied(true);
    } catch (error) {
      console.warn('Failed to copy install command', error);
      setCopyError(true);
      setCopied(false);
    }
  };

  const copyLabel = copyError
    ? 'Copy failed. Select the command and press Ctrl+C or Command+C.'
    : copied
      ? 'Install command copied to clipboard.'
      : 'Copy and paste into your terminal to analyze a project.';

  return (
    <section className="hero" id="hero">
      <div className="hero-background" aria-hidden="true">
        <div className="hero-orb hero-orb--cyan" />
        <div className="hero-orb hero-orb--blue" />
        <div className="hero-orb hero-orb--teal" />
        <div className="hero-grid" />
        {mounted &&
          particles.map((particle, index) => (
            <span
              key={`particle-${index}`}
              className="hero-particle"
              style={{
                left: particle.left,
                top: particle.top,
                animationDuration: particle.duration,
                animationDelay: particle.delay,
                opacity: particle.opacity,
              }}
            />
          ))}
      </div>

      <div className="container hero-inner">
        <div className="hero-badge">
          <span className="ping">
            <span className="ping-ring" aria-hidden />
            <span className="ping-core" aria-hidden />
          </span>
          Free Analyzer · Pro Overlay
        </div>

        <h1 className="hero-title">
          See your React Server <span className="hero-highlight">Components</span>
          <br />
          Fix waterfalls. Ship faster.
        </h1>

        <p className="hero-subtitle">
          The free analyzer generates <span>model.json</span> and a shareable HTML report. Pro
          unlocks the live overlay with hydration timings, cache lens, a Flight timeline, and CI
          budgets.
        </p>

        <div className="hero-actions">
          <a className="button primary hero-action" href="https://demo.rsc-xray.dev">
            <Play size={18} className="icon" aria-hidden />
            <span>Try the live demo</span>
          </a>
          <button className="button secondary hero-action" type="button" onClick={handleCopy}>
            {copied ? (
              <Check size={18} className="icon icon-success" aria-hidden />
            ) : (
              <Copy size={18} className="icon" aria-hidden />
            )}
            <span>{copied ? 'Copied!' : 'Copy install command'}</span>
          </button>
        </div>

        <div className="install-shell" id="install">
          <div className="install-shell-header">
            <span>CLI install</span>
            <button className="install-shell-copy" type="button" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check size={16} className="icon icon-success" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={16} className="icon" aria-hidden />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre>
            <code>{INSTALL_COMMAND}</code>
          </pre>
          <div className="install-feedback" role="status" aria-live="polite">
            {copyLabel}
          </div>
        </div>

        <div className="hero-trust">
          <div className="hero-chip">
            <svg className="hero-chip-icon" viewBox="0 0 24 24" role="img" aria-hidden>
              <path
                d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.76 9.76 0 0 0 12 2.25Zm4.489 8.572-4.8 4.8a.75.75 0 0 1-1.06 0l-2.4-2.4a.75.75 0 1 1 1.06-1.06l1.87 1.87 4.27-4.27a.75.75 0 1 1 1.06 1.06Z"
                fill="currentColor"
              />
            </svg>
            Works with Next.js App Router 13.4–15.x
          </div>
          <div className="hero-chip">
            <span className="hero-chip-dot" aria-hidden /> Local analysis by default
          </div>
          <div className="hero-chip">
            <span className="hero-chip-dot" aria-hidden /> No telemetry without consent
          </div>
        </div>
      </div>
    </section>
  );
}
