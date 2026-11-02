import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageUrl = pathToFileURL(require.resolve('typedoc/package.json'));
const utilitiesUrl = new URL('./dist/node-utils.js', packageUrl).href;

// TypeDoc 0.28.20 uses a removed directory traversal API. Keep the security
// override and use supported partial pattern matching instead.
// This changes only the loaded source; installed dependencies remain untouched.
const legacyTraversal = `return mini.set.some((row) => mini.matchOne(
        childPath,
        row,
        /* partial */
        true
      ));`;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== utilitiesUrl) {
      return result;
    }

    const source = String(result.source);
    if (source.split(legacyTraversal).length !== 2) {
      throw new Error('TypeDoc traversal changed; review the compatibility script.');
    }

    return {
      ...result,
      source: source.replace(legacyTraversal, 'return mini.match(childPath.join("/"), true);'),
    };
  },
});
