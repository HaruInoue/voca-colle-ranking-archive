import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://haruinoue.github.io',
  base: '/voca-colle-ranking-archive',
  build: {
    format: 'directory',
  },
});
