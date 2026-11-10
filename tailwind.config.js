/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#063D32',
        'forest-deep': '#032F28',
        'forest-soft': '#155747',
        gold: '#E6BC4F',
        'gold-soft': '#F5D98A',
        'gold-pale': '#FBF0CF',
        cream: '#F6F1E3',
        'cream-soft': '#FBF7EC',
        card: '#FFFDF7',
        ink: '#153B32',
        muted: '#7A8178',
        line: '#E8DFC9'
      },
      fontFamily: {
        display: ['Alexandria', 'IBM Plex Sans Arabic', 'Tahoma', 'sans-serif'],
        body: ['IBM Plex Sans Arabic', 'Tajawal', 'Tahoma', 'Arial', 'sans-serif']
      },
      borderRadius: {
        xl2: '24px',
        xl3: '30px'
      },
      boxShadow: {
        soft: '0 14px 36px rgba(6,61,50,.10)',
        gold: '0 10px 24px rgba(230,188,79,.32)'
      }
    }
  },
  plugins: []
};
