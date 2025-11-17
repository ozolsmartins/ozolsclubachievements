// Next.js 15 requires PostCSS config plugins to be specified using
// the object-map shape rather than instantiated functions.
// Tailwind CSS v4 provides its PostCSS plugin via "@tailwindcss/postcss".
// See: https://nextjs.org/docs/messages/postcss-shape

export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
