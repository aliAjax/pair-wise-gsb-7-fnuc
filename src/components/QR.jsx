import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// 真实可扫描的二维码（qrcode 生成 data URL）
export default function QR({ text, size = 120 }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, {
      width: size * 2, // 高分屏
      margin: 1,
      color: { dark: '#18252a', light: '#ffffff' },
    }).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [text, size]);

  if (!url) return <div className="qr-ph" style={{ width: size, height: size }}>▦</div>;
  return <img className="qr-img" src={url} width={size} height={size} alt="展项二维码" />;
}
