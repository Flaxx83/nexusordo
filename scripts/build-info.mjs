// Byggets version (#78): senaste commit (kort hash), datum och tid (build-lokal.mjs).
// Skrivs in i script.js mellan BUILD:START/BUILD:END som TP_BUILD; källkoden har null.
// Export (#69) och mallfiler (#73) bär versionen, så att appen kan varna för filer från en nyare version.
import { execFileSync } from 'node:child_process';

export function buildInfo(repoPath) {
  const git = (...a) => {
    try { return execFileSync('git', ['-c', 'safe.directory=' + repoPath, '-C', repoPath, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  };
  return { version: git('rev-parse', '--short', 'HEAD') || 'dev', date: git('log', '-1', '--format=%cs') || '', at: git('log', '-1', '--format=%cI') || '' };
}

const RE = /\/\* BUILD:START \*\/[\s\S]*?\/\* BUILD:END \*\//;
export function embedBuild(script, info) {
  if (!RE.test(script)) throw new Error('Hittar inte BUILD:START/BUILD:END i script.js');
  return script.replace(RE, () => `/* BUILD:START */\nconst TP_BUILD = ${JSON.stringify(info)};\n/* BUILD:END */`);
}
