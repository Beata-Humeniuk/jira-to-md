# Jira to Markdown

## Releases

Every PR that changes what users get (code in `src/`, `media/`, `package.json`
contributions) bumps the version in the same PR, following SemVer:

- patch (0.2.0 → 0.2.1) for fixes,
- minor (0.2.1 → 0.3.0) for new features or changed behaviour,
- major only for breaking changes to settings or commands.

Bump with `npm version <x.y.z> --no-git-tag-version` so `package-lock.json`
follows, and rename the CHANGELOG section to `## [x.y.z] - YYYY-MM-DD`.
The publish workflow releases a version only when its `v<version>` tag does not
exist yet, so a merged change without a bump is never published.

Run `npm test` and `npm run build` before pushing.
