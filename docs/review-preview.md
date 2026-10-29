# Review preview (issue #7)

Preparation only: this does not authorize publication. Do not push this workflow with the
current OAuth credential (it lacks workflow scope), enable Pages, add secrets, change
permissions, or run a deployment without separate human approval. Issue #7 stays open until
the approved public link and the plan's issues have actually been sent to the reviewer.

## Local export

From the checkout root, with dependencies installed and Node 22+, run:

```sh
node --import tsx scripts/export-preview.ts /absolute/path/outside-checkout/rig-preview/index.html
```

Choose an output directory **outside the checkout**, including when testing. The exporter
starts the existing app on an ephemeral `127.0.0.1` port, fetches only
`/digest/2026-10-28` from the checked-in sample fixtures, requires HTTP 200 HTML, writes one
self-contained file, and closes the server even on failure. It does not start the heartbeat,
load `.env`, or print HTML or marker values. There is no client JavaScript or external asset
build. Do not change `runs/` or supply real night data for a public preview.

For a marked copy, supply `LANE_MARKER` through the process environment using the approved
secret-handling mechanism, never as a literal in code, shell history, logs, issues, or chat.
For a clean copy:

```sh
env -u LANE_MARKER node --import tsx scripts/export-preview.ts /absolute/path/outside-checkout/rig-preview/index.html
```

The clean banner reads `no marker set`. Never commit generated HTML or attach it to an issue
or chat. Delete local test copies after checking them.

## Publishing prerequisites — separate approval required

A human must authorize each deployment, including cleanup. Before any dispatch, obtain
approval for publication of the sample page, its lane banner, the target repository's
public Pages URL, and replacement of any existing site there. Anyone can read the published
page. Repository users with artifact access may also read the temporary build artifact.

The authorized maintainer must separately arrange:

- A credential permitted to push workflow files, and review/merge onto the default branch.
  Do not grant this scope or push as part of preparation.
- GitHub Pages configured to use **GitHub Actions** in this repository. The workflow does
  not enable Pages or grant repository permissions itself.
- The `github-pages` environment with required human reviewers, appropriate branch
  restrictions, and self-approval prevented where supported. Verify this gate is available
  and active before dispatch; naming an environment in YAML does not configure approval.
- A repository Actions secret named `LANE_MARKER` for marked exports, provided through the
  secrets UI without printing it. It must be nonempty. Do not add secrets during preparation.

The build job only reads repository contents. The deployment job requests only
`pages: write` and `id-token: write`; those grants apply to that job, not the build.
This follows GitHub's [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Approved marked review

1. After explicit approval, manually run **Review preview** on the approved revision with
   mode `marked`. There are no push, pull-request, or scheduled triggers.
2. The workflow installs the frozen lockfile with pnpm 12.16.1 on Node 22, runs tests and
   typechecking, and exports to `$RUNNER_TEMP/rig-preview/index.html`. Marked mode fails if
   the secret is empty or whitespace-only. No marker or HTML is written to logs.
3. `upload-pages-artifact@v4` retains the HTML artifact for one day; no preview enters Git.
   The human then approves the `github-pages` deployment gate. `deploy-pages@v4` publishes it.
4. Record the deployment's exact public HTTPS `page_url` (including any repository path).
   Verify that URL renders the sample digest and banner, without copying the marker into
   logs. After approval to send, give the reviewer that URL and the plan's issue links.

Artifact expiration does **not** remove the public page or clean its marker.

## Approved cleanup at the exact same URL

1. Obtain explicit approval to replace the marked page, then manually dispatch the same
   workflow in the same repository with mode `clean`. Do not change the Pages domain,
   repository path, or output filename. The workflow explicitly unsets `LANE_MARKER`, even
   if the repository secret still exists; the exporter never reloads it from `.env`.
2. Approve this deployment separately at the environment gate. It overwrites `index.html`
   at the **exact same public URL**, not a second preview URL.
3. Fetch that original URL after deployment and confirm the banner reads `no marker set`
   and the old marker is absent (allow for CDN caching). Do not log the old marker or HTML.
   Remove any still-retained marked artifact through a separately approved deletion if
   needed; a one-day retention policy is not immediate removal.
4. Complete the plan's cleanup issue only after that verification. Disabling future workflow
   runs or deleting a secret does not clean an already published page. To undo an approved
   publication, replace it with this clean artifact at the same URL; removing the whole
   Pages site instead requires its own approval and breaks the review link.
