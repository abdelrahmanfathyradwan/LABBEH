import { Html, Head, Main, NextScript } from 'next/document';
export default function Document(){
  return <Html lang="ar" dir="rtl">
    <Head>
      <meta name="theme-color" content="#063D32"/>
      <meta name="description" content="لبيه - منصة التسوق والطلبات المحلية في عزان، شبوة"/>
      <link rel="icon" href="/favicon.png" type="image/png" sizes="64x64"/>
      <link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
      <link
        href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Tajawal:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
    </Head>
    <body><Main/><NextScript/></body>
  </Html>;
}
