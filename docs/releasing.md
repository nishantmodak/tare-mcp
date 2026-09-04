# Releasing tare-mcp

Use this checklist for npm releases.

## Trusted publisher

The npm package must have a GitHub Actions trusted publisher configured with these exact values:

- Organization or user: `nishantmodak`
- Repository: `tare-mcp`
- Workflow filename: `publish-npm.yml`
- Environment name: empty
- Allowed action: direct publishing with `npm publish`

The workflow uses GitHub OIDC and does not require an `NPM_TOKEN` secret.

## Patch release

1. Update versions:

   ```bash
   npm version patch --no-git-tag-version
   ```

2. Ensure `src/version.ts` matches `package.json`.

3. Run release checks:

   ```bash
   pnpm test
   pnpm run lint
   pnpm build
   npm pack --dry-run
   ```

4. Commit and push:

   ```bash
   git add package.json src/version.ts
   git commit -m "chore: release x.y.z"
   git push
   ```

5. Create the GitHub release. This triggers `.github/workflows/publish-npm.yml`:

   ```bash
   git tag vx.y.z
   git push origin vx.y.z
   gh release create vx.y.z --title "tare-mcp vx.y.z" --notes "..."
   ```

6. Watch the publish workflow:

   ```bash
   gh run list --workflow publish-npm.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

7. Verify npm:

   ```bash
   npm view tare-mcp version
   npx --yes tare-mcp@latest --version
   ```

## Notes

- npm versions are immutable. If a publish needs a correction, bump to the next patch version.
- The npm package page snapshots `README.md` at publish time. README-only improvements still need a patch release if npm should show them.
- `publish-npm.yml` also supports manual dispatch, but do not run manual dispatch and then create a release for the same version. Creating the release will trigger a second publish attempt for an immutable npm version.
- If a release-triggered publish fails before reaching npm, fix the cause and manually dispatch the workflow once from the tagged commit or an equivalent clean `main` commit.
