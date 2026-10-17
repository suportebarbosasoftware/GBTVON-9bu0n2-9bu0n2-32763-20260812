/* Builds a static webOS package directory from Expo's web export. */
const { execFileSync } = require('child_process');
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const output = join(root, 'webos', 'dist');
const temp = join(root, 'webos', '.tmp');
const metadata = join(root, 'webos', 'appinfo.json');
// The store icon has a solid black background as required by LG's QA. The
// expressive logo stays available inside the application UI.
const icon = join(root, 'assets', 'images', 'lg-store-icon.png');

function rewriteWebOSPaths(directory, depth = 0) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteWebOSPaths(path, depth + 1);
    } else if (entry.name.endsWith('.html')) {
      const relativePrefix = '../'.repeat(depth);
      let html = readFileSync(path, 'utf8').replace(
        /(["'])\/(?=(?:_expo\/|assets\/|favicon\.ico))/g,
        `$1${relativePrefix}`,
      );

      // A packaged webOS app is launched as file:///.../index.html. Expo
      // Router would otherwise interpret the full on-device filesystem path
      // as its route after hydration. Normalise it before Expo starts, while
      // keeping the already-loaded package document in place.
      if (depth === 0 && entry.name === 'index.html' && !html.includes('history.replaceState')) {
        html = html.replace(
          '</head>',
          '<base href="./"><script>if(location.protocol===\'file:\'){try{history.replaceState(null,\'\',\'/\')}catch(_){}}</script></head>',
        );
      }
      writeFileSync(path, html);
    } else if (entry.name.endsWith('.js')) {
      // Expo embeds web asset paths in the JavaScript bundle as /assets/...
      // URLs. A webOS package runs from file://, where those absolute paths
      // point outside the app and are denied. Keep them document-relative.
      const script = readFileSync(path, 'utf8').replace(
        /(["'])\/(?=(?:_expo\/|assets\/))/g,
        '$1',
      );
      writeFileSync(path, script);
    }
  }
}

if (!process.argv.includes('--prepare-only')) {
  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  mkdirSync(temp, { recursive: true });

  execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', output, '--max-workers', '1', '--no-minify'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // Metro's image pipeline resolves the OS temporary directory. Keeping it
    // inside the workspace also avoids Windows permission issues on user paths.
    env: { ...process.env, TEMP: temp, TMP: temp },
  });
}

rewriteWebOSPaths(output);
cpSync(metadata, join(output, 'appinfo.json'));
cpSync(icon, join(output, 'icon.png'));
console.log(`webOS package files prepared in ${output}`);
