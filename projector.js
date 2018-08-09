const { getWorkspaces } = require('bolt');
const chalk = require('chalk');
const charm = require('charm')();
const execa = require('execa');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const outdent = require('outdent');
const semver = require('semver');

function exec(...args) {
  return execa(...args).catch(console.log);
}

async function parallel(...args) {
  let code;
  const fn = args.pop();
  const mappedArgs = args.map(a => JSON.stringify(a) || 'null').join(',');
  const iife = code => `
    (async () => {
      const result = await ${code}(${mappedArgs});
      console.log(JSON.stringify(typeof result === 'undefined' ? null : result));
    })();
  `;

  if (typeof fn === 'string') {
    code = iife(`require('${path.resolve(__dirname, fn)}')`);
  } else {
    code = iife(`(${fn.toString()})`);
  }

  return exec('node', ['-e', code])
    .then(s => {
      if (s.stderr) {
        throw s.stderr;
      }
      return JSON.parse(s.stdout || null);
    })
    .catch(console.error);
}

function need(val, msg) {
  if (!val) {
    throw new Error(msg);
  }
}

charm.pipe(process.stdout);
charm.goto = function(pos /*: 'start' | 'end' */) {
  return this[pos === 'start' ? 'left' : 'right'](100000);
};

async function getTags() {
  return (await exec('git', ['tag'])).stdout.split('\n');
}

async function getTagsFor(name) {
  return (await getTags()).filter(t => t.indexOf(name) === 0);
}

async function getLatestTagFor(name) {
  const tags = await getTagsFor(name);
  return tags.length ? tags[tags.length - 1] : null;
}

async function getLatestVersionFromTag(tag) {
  const parts = tag.split('-');
  return parts && parts.length ? parts[parts.length - 1] : null;
}

async function getCommitsSinceTag(tag) {
  const diff = (await exec('git', ['log', `${tag}...master`, '--oneline']))
    .stdout;
  return diff
    .split('\n')
    .filter(Boolean)
    .map(d => {
      const [hash, ...rest] = d.split(' ');
      return {
        hash,
        message: rest.join(' ')
      };
    });
}

async function getFilesForCommit(commit) {
  return (await exec('git', [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    commit
  ])).stdout
    .split('\n')
    .filter(Boolean)
    .map(f => f.replace('/', path.sep));
}

async function getChangesInWorkspace(workspace) {
  const latestTag = await getLatestTagFor(workspace.name);
  if (latestTag) {
    const commits = await getCommitsSinceTag(latestTag);
    const mapped = await Promise.all(
      commits.map(async c => {
        const files = await getFilesForCommit(c.hash);
        return files.some(f => {
          const relativeWorkspaceDir = path.relative(
            process.cwd(),
            workspace.dir
          );
          return f.indexOf(relativeWorkspaceDir) === 0;
        })
          ? c
          : null;
      })
    );
    return mapped.filter(Boolean);
  }
  return [];
}

function inferReleaseType(message) {
  const lc = message.toLowerCase();
  if (lc.includes('breaking')) {
    return 'major';
  }
  if (lc.includes('implements')) {
    return 'minor';
  }
  return 'patch';
}

function calculateReleaseType(changes) {
  const weight = { major: 2, minor: 1, patch: 0 };
  return changes.reduce((currentWeight, change) => {
    const recommended = inferReleaseType(change.message);
    if (currentWeight < weight[recommended]) {
      return weight[recommended];
    }
    return currentWeight;
  }, 'patch');
}

function calculateNextVersion(version, changes) {
  return semver.inc(version, calculateReleaseType(changes));
}

async function build() {
  const ws = await getWorkspaces();
  await Promise.all(
    ws.map(w => {
      return parallel(
        w.dir,
        w.config.main,
        w.config.module,
        async (dir, entryMain, entryModule) => {
          const exec = require('execa');
          const fs = require('fs-extra');
          const path = require('path');
          const index = path.join(`${dir}`, 'src', 'index.ts');

          if (!await fs.exists(index)) {
            return;
          }

          if (entryMain) {
            const result1 = await exec(
              'tsc',
              ['--outDir', path.dirname(entryMain), '--module', 'CommonJS'],
              {
                cwd: dir
              }
            )
              .catch(e => e)
              .then(r => r.stdout);
          }

          if (entryModule) {
            const result1 = await exec(
              'tsc',
              ['--outDir', path.dirname(entryModule), '--module', 'ES2015'],
              {
                cwd: dir
              }
            )
              .catch(e => e)
              .then(r => r.stdout);
          }
        }
      ).then(r => r && console.log(r));
    })
  );
}

async function changed() {
  for (const w of await getWorkspaces()) {
    const changes = await getChangesInWorkspace(w);
    if (changes.length) {
      console.log(
        outdent`

          ${w.config.name} ${chalk`{green ${
          w.config.version
        }}`} -> ${chalk`{yellow ${calculateNextVersion(
          w.config.version,
          changes
        )}}`}
            ${changes
              .map(
                d =>
                  `${d.hash} ${chalk`{yellow ${inferReleaseType(
                    d.message
                  )}}`} ${d.message}`
              )
              .join(`${os.EOL}  `)}
        `
      );
    }
  }
}

async function clean() {
  parallel(() => require('fs-extra').remove('./site/public'));
  for (const w of await getWorkspaces()) {
    parallel(w.dir, async dir => {
      const fs = require('fs-extra');
      const path = require('path');
      const toRemove = path.relative(process.cwd(), path.join(dir, 'dist'));
      await fs.remove(toRemove);
      return toRemove;
    }).then(console.log);
  }
}

async function release({ packages, type }) {
  need(packages, 'Please specify at least one package.');
  need(type, 'Please specify a release type (or version number).');
  await exec('bolt', ['build']);
  const ws = await getWorkspaces();
  for (const pkg of packages.split(',')) {
    const name = pkg.trim();
    const w = ws.filter(w => w.name === name)[0];
    if (!w) continue;
    const cwd = w.dir;
    await exec('npm', ['--no-git-tag-version', 'version', type], { cwd });
    const ver = require(path.join(cwd, 'package.json')).version;
    const tag = `${name}-${ver}`;
    await exec('git', ['commit', '-am', tag], { cwd });
    await exec('git', ['tag', '-a', tag, '-m', tag], { cwd });
    await exec('npm', ['publish'], { cwd });
  }
  await exec('git', ['push', '--follow-tags']);
}

// All platforms.
async function rm({ path }) {
  return fs.remove(path);
}

module.exports = {
  build,
  changed,
  clean,
  release,
  rm
};
