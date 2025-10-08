import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Check, Copy, Play } from 'lucide-react';
import '../base.css';
import './variant01.css';
import { t } from '../content/text';
import PageShell from './common/PageShell';

function Page() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(t('cli_command'));
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
      setCopied(false);
    }
  };
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  const hero = (
    <section className="v1-hero" id="hero">
      <div className="v1-bg" aria-hidden>
        <div className="v1-grid" />
        <div className="v1-orb v1-orb-a" />
        <div className="v1-orb v1-orb-b" />
      </div>
      <div className="container v1-inner">
        <div className="v1-badge">{t('tag')}</div>
        <h1 className="v1-title">
          {t('h1_l1')} <span className="v1-accent">{t('h1_accent')}</span>
          <br />
          {t('h1_l2')}
        </h1>
        <p className="v1-sub">{t('sub')}</p>
        <div className="v1-actions">
          <a className="button primary v1-btn" href="https://demo.rsc-xray.dev">
            <Play size={18} className="icon" aria-hidden /> {t('cta_demo')}
          </a>
          <button className="button secondary v1-btn" onClick={handleCopy} type="button">
            {copied ? (
              <Check size={18} className="icon icon-success" aria-hidden />
            ) : (
              <Copy size={18} className="icon" aria-hidden />
            )}
            {copied ? 'Copied!' : t('cta_copy')}
          </button>
        </div>
        <div className="v1-shell" id="install">
          <div className="v1-shell-head">
            <span>{t('cli_label')}</span>
            <button className="v1-copy" onClick={handleCopy} type="button">
              <Copy size={14} className="icon" aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre>
            <code>{t('cli_command')}</code>
          </pre>
          <div className="install-feedback" role="status" aria-live="polite">
            {error
              ? 'Copy failed. Select and press Ctrl/Cmd+C.'
              : copied
                ? 'Install command copied to clipboard.'
                : 'Copy and paste into your terminal to analyze a project.'}
          </div>
        </div>
        <div className="v1-chips">
          <span className="chip">{t('chip_next')}</span>
          <span className="chip">{t('chip_local')}</span>
          <span className="chip">{t('chip_notel')}</span>
        </div>
      </div>
    </section>
  );

  return <PageShell hero={hero} rootClass="v1 page" />;
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  );
}
