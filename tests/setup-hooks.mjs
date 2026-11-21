import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workerFileUrl = pathToFileURL(
  path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,export default ${JSON.stringify(workerFileUrl)};`,
      };
    }

    const parent = context.parentURL ?? '';
    const isProjectFile = !parent.includes('/node_modules/');

    if (
      isProjectFile &&
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }

    return nextResolve(specifier, context);
  },
});
