// --- components/IabInstallBanner.tsx ---
import React, { useEffect, useState } from "react";

const IabInstallBanner: React.FC = () => {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isFB = /(FBAN|FBAV|FB_IAB|FBIOS|FBAN\/Messenger)/i.test(ua);
    const isIG = /Instagram/i.test(ua);
    const inIAB = isFB || isIG;
    const iOS = /iPad|iPhone|iPod/i.test(ua);
    const android = /Android/i.test(ua);

    if (inIAB) {
      setShow(true);
      setIsIOS(iOS);
      setIsAndroid(android);
    }
  }, []);

  if (!show) return null;

  const currentUrl = window.location.href;

  const handleOpen = () => {
    if (isAndroid) {
      const intent = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
      window.location.href = intent;
    } else {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      alert("Link copied! Open it in your browser to install.");
    } catch {
      prompt("Copy this URL:", currentUrl);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        left: "1rem",
        right: "1rem",
        bottom: "1rem",
        zIndex: 9999,
        background: "#171717",
        color: "#fff",
        padding: "1rem",
        borderRadius: "12px",
        boxShadow: "0 6px 20px rgba(0,0,0,.4)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h4 style={{ margin: "0 0 .5rem 0" }}>Install Spot The Aurora</h4>
      <p style={{ margin: "0 0 .75rem 0", fontSize: ".9rem", lineHeight: 1.4 }}>
        {isIOS
          ? "Open in Safari to install: Share → Add to Home Screen."
          : "Open in Chrome to install: ⋮ → Install app."}
      </p>
      <div style={{ display: "flex", gap: ".5rem" }}>
        <button
          onClick={handleOpen}
          style={{
            flex: 1,
            padding: ".6rem",
            borderRadius: "8px",
            fontWeight: 700,
            background: "#fff",
            color: "#111",
            border: "none",
          }}
        >
          Open in Browser
        </button>
        <button
          onClick={handleCopy}
          style={{
            flex: 1,
            padding: ".6rem",
            borderRadius: "8px",
            fontWeight: 700,
            background: "#333",
            color: "#fff",
            border: "none",
          }}
        >
          Copy Link
        </button>
      </div>
    </div>
  );
};

export default IabInstallBanner;
