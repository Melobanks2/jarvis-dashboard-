/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:     '#0c0d14',
        bg2:    '#121320',
        bg3:    '#181928',
        bg4:    '#1d1e2e',
        // accent palette — toned down, premium
        ngreen: '#4ade80',
        ngold:  '#fbbf24',
        nred:   '#f87171',
        norange:'#fb923c',
        nblue:  '#60a5fa',
        npurple:'#a78bfa',
        ncyan:  '#67e8f9',
        // text
        ndim:   '#1c1c2e',
        dimtext:'#52526e',
        jtext:  '#c4c4d6',
        textb:  '#e4e4f0',
        // borders
        jborder:'rgba(255,255,255,0.06)',
        border2:'rgba(255,255,255,0.10)',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        mono:     ['Inter', '-apple-system', 'sans-serif'],
        sans:     ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      animation: {
        blink:       'blink 3s ease-in-out infinite',
        float:       'float 4s ease-in-out infinite',
        'pulse-ring':'pulse-ring 3s ease-in-out infinite',
        marquee:     'marquee 45s linear infinite',
        'fade-in':   'fadeIn .4s ease-out',
      },
      keyframes: {
        blink:      { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'pulse-ring':{ '0%': { transform: 'scale(0.92)', opacity: '0.5' }, '50%': { transform: 'scale(1.08)', opacity: '0.12' }, '100%': { transform: 'scale(0.92)', opacity: '0.5' } },
        marquee:    { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        fadeIn:     { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
