import React, { useEffect, useState } from 'react';

const mainBundle = (html) => html.match(/static\/js\/main\.[a-z0-9]+\.js/)?.[0] || null;
const mainStylesheet = (html) => html.match(/static\/css\/main\.[a-z0-9]+\.css/)?.[0] || null;

export default function AppUpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let lastChecked = 0;
    let active = true;
    const currentBundle = [...document.scripts]
      .map((script) => script.src.match(/static\/js\/main\.[a-z0-9]+\.js/)?.[0])
      .find(Boolean);
    const currentStylesheet = [...document.styleSheets]
      .map((sheet) => sheet.href?.match(/static\/css\/main\.[a-z0-9]+\.css/)?.[0])
      .find(Boolean);

    const check = async () => {
      if (!currentBundle || !navigator.onLine || Date.now() - lastChecked < 30000) return;
      lastChecked = Date.now();
      try {
        const response = await fetch(`/index.html?update_check=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const html = await response.text();
        const latestBundle = mainBundle(html);
        const latestStylesheet = mainStylesheet(html);
        if (active && ((latestBundle && latestBundle !== currentBundle)
          || (currentStylesheet && latestStylesheet && latestStylesheet !== currentStylesheet))) {
          setUpdateAvailable(true);
        }
      } catch (_) {
        // Keep the installed app usable while offline.
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', check);
    check();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', check);
    };
  }, []);

  if (!updateAvailable) return null;
  return <div className="wbp-app-update" role="status">
    <span>A newer version is ready.</span>
    <button type="button" onClick={() => window.location.replace(`${window.location.pathname}?app_update=${Date.now()}`)}>Update app</button>
  </div>;
}
