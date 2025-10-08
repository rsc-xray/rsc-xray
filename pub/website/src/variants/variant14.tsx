import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Check, Copy, Play } from 'lucide-react';
import '../base.css';
import './variant14.css';
import { t } from '../content/text';
import PageShell from './common/PageShell';

function Page() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const copy = async () => {
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
    <section className="v-hero" id="hero">
      <div className="v-bg" aria-hidden>
        <div className="v-noise" />
        <div className="v-hue" />
      </div>
      <div className="container v-inner">
        <div className="v-badge">{t('tag')}</div>
        <h1 className="v-title">
          {t('h1_l1')} <span className="v-accent">{t('h1_accent')}</span>
          <br />
          {t('h1_l2')}
        </h1>
        <p className="v-sub">{t('sub')}</p>
        <div className="v-actions">
          <a className="button primary v-btn" href="https://demo.rsc-xray.dev">
            <Play size={18} className="icon" aria-hidden /> {t('cta_demo')}
          </a>
          <button className="button secondary v-btn" onClick={copy} type="button">
            {copied ? (
              <Check size={18} className="icon icon-success" aria-hidden />
            ) : (
              <Copy size={18} className="icon" aria-hidden />
            )}
            {copied ? 'Copied!' : t('cta_copy')}
          </button>
        </div>
        <div className="v-shell" id="install">
          <div className="v-shell-head">
            <span>{t('cli_label')}</span>
            <button className="v-copy" onClick={copy} type="button">
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
        <div className="v-chips">
          <span className="chip">{t('chip_next')}</span>
          <span className="chip">{t('chip_local')}</span>
          <span className="chip">{t('chip_notel')}</span>
        </div>
      </div>
    </section>
  );
  return <PageShell hero={hero} rootClass="v14 page" />;
}

const root = document.getElementById('root');
if (root)
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  );
