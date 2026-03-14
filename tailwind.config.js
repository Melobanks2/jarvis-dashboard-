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
        bg:     '#0a0a0f',
        bg2:    '#0c0c18',
        bg3:    '#101020',
        bg4:    '#13132a',
        ngreen: '#00ff88',
        ngold:  '#ffd700',
        nred:   '#ff3366',
        norange:'#ff8800',
        nblue:  '#00aaff',
        npurple:'#aa44ff',
        ncyan:  '#00e5ff',
        ndim:   '#2a2a46',
        dimtext:'#5a5a80',
        jtext:  '#b8c0d8',
        textb:  '#dde6f8',
        jborder:'#16162e',
        border2:'#1e1e3a',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        mono:     ['Share Tech Mono', 'monospace'],
      },
      animation: {
        blink:       'blink 2s infinite',
        float:       'float 3s ease-in-out infinite',
        glow:        'glow 2s ease-in-out infinite',
        'glow-gold': 'glow-gold 2.8s ease-in-out infinite',
        'pulse-ring':'pulse-ring 2.5s ease-in-out infinite',
        'marquee':   'marquee 40s linear infinite',
      },
      keyframes: {
        blink:      { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.2' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        glow:       { '0%,100%': { boxShadow: '0 0 5px rgba(0,255,136,.3)' }, '50%': { boxShadow: '0 0 22px rgba(0,255,136,.8),0 0 44px rgba(0,255,136,.4)' } },
        'glow-gold':{ '0%,100%': { boxShadow: '0 0 5px rgba(255,215,0,.3)' }, '50%': { boxShadow: '0 0 22px rgba(255,215,0,.8),0 0 44px rgba(255,215,0,.4)' } },
        'pulse-ring':{ '0%': { transform: 'scale(0.9)', opacity: '0.6' }, '50%': { transform: 'scale(1.15)', opacity: '0.15' }, '100%': { transform: 'scale(0.9)', opacity: '0.6' } },
        marquee:    { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
      },
    },
  },
  plugins: [],
};
