/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media', // sigue prefers-color-scheme del sistema
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': {
          from: { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        shimmer: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
        'pulse-dot': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
        'check-draw': { from: { strokeDashoffset: 24 }, to: { strokeDashoffset: 0 } },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'pop-in': 'pop-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
