/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ca-bg':       '#070B12',
        'ca-bg2':      '#101A29',
        'ca-gold':     '#FFC857',
        'ca-cyan':     '#64D8EB',
        'ca-orange':   '#FF9900',
        'ca-text':     '#F5F7FA',
        'ca-muted':    '#A6B2C3',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'beam-pulse': 'beamPulse 4s ease-in-out infinite',
        'float':      'float 6s ease-in-out infinite',
        'flicker':    'flicker 3s ease-in-out infinite',
        'fade-in':    'fadeIn 1.2s ease forwards',
        'slide-up':   'slideUp 0.8s ease forwards',
      },
      keyframes: {
        beamPulse: {
          '0%, 100%': { opacity: '0.6', transform: 'scaleY(1)' },
          '50%':      { opacity: '1',   transform: 'scaleY(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.7' },
          '75%':      { opacity: '0.9' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
