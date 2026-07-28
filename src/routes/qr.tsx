import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Rex from "~/components/Rex";
import brand from "~/branding";

export const Route = createFileRoute("/qr")({
  component: QrPage,
});

const SITE_URL = "https://fc0fde2e702be4fba7557dc896972dfc.ctonew.app";

function QrPage() {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(SITE_URL, {
      width: 300,
      margin: 2,
      color: {
        dark: "#008C95",
        light: "#FFFFFF",
      },
    }).then(setQrDataUrl);
  }, []);

  return (
    <div className="page-container flex flex-col items-center text-center print:pt-0 print:min-h-0">
      {/* LightBox Logo */}
      <div className="mb-4 print:mb-2">
        <img
          src="/welcome-lightbox-logo-opt.png"
          alt="LightBox"
          className="h-16 w-auto mx-auto print:h-12"
        />
      </div>

      {/* Rex */}
      <Rex className="w-16 h-16 mb-3 print:w-12 print:h-12 print:mb-1" mood="happy" />

      {/* Heading */}
      <h1 className="text-2xl font-bold text-white mb-1 print:text-xl print:mb-0">
        Scan to Play!
      </h1>
      <p className="text-sm text-white/70 mb-6 print:text-xs print:mb-3">
        No app needed — just point your camera
      </p>

      {/* QR Code */}
      <div className="bg-white rounded-2xl p-4 shadow-lg print:shadow-none print:p-3">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR code to LightBox PLAY"
            className="w-64 h-64 print:w-48 print:h-48"
          />
        ) : (
          <div className="w-64 h-64 flex items-center justify-center print:w-48 print:h-48">
            <div className="text-lg text-mutedText animate-pulse">Generating QR...</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-white/40 mt-4 print:mt-2 print:text-[10px]">
        {brand.name} · Patient Engagement Platform
      </p>

      {/* Print-only styles */}
      <style>{`
        @media print {
          @page { margin: 0.5cm; }
          body { background: white !important; }
          .page-container { max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}
