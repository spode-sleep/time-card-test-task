import { existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

export const frontendDirectory = fileURLToPath(
  new URL('../../frontend/dist/', import.meta.url),
);

export function installFrontend(app: Express, directory = frontendDirectory) {
  const index = resolve(directory, 'index.html');
  if (!existsSync(index)) {
    throw new Error(
      'Frontend build is missing. Run npm run build before production startup.',
    );
  }

  app.use(
    express.static(directory, {
      index: false,
      dotfiles: 'ignore',
      setHeaders(response, file) {
        const path = relative(directory, file).split(sep).join('/');
        response.setHeader(
          'Cache-Control',
          path === 'index.html'
            ? 'no-store'
            : path.startsWith('assets/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=0, must-revalidate',
        );
      },
    }),
  );
  app.use((request, response, next) => {
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      !request.accepts('html') ||
      request.path.split('/').some((segment) => segment.includes('.'))
    ) {
      next();
      return;
    }
    response.set('Cache-Control', 'no-store');
    response.sendFile('index.html', { root: directory });
  });
}
