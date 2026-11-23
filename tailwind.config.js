/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        navy: { 950: '#050811', 900: '#080D1A', 800: '#101829', 700: '#18243D', 600: '#243456' },
        coral: '#FF6B5E',
      },
    },
  },
  plugins: [],
};
