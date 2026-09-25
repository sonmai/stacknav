# Marketplace publishing

StackNav publishes a new VSIX to both the Visual Studio Marketplace and GitHub Releases after a pull request is merged into `main`. The release workflow uses GitHub OIDC, so the repository does not need a Marketplace PAT, an Azure client secret, or an Entra application.

## One-time Marketplace setup

1. Open the [StackNav publisher page](https://marketplace.visualstudio.com/manage/publishers/sonmai).
2. Create a trusted publishing policy for:
   - GitHub owner: `sonmai`
   - Repository: `stacknav`
   - Workflow: `.github/workflows/release.yml`
3. Save the policy under the `sonmai` publisher.

The policy must match the repository and workflow exactly. No GitHub Actions secret or variable is required.

## Release flow

The `.github/workflows/release.yml` workflow runs on every push to `main` and can also be started manually from GitHub Actions. It:

1. Installs dependencies and runs the test suite.
2. Generates a unique version from the package major and minor version plus the GitHub run number.
3. Packages the extension as a VSIX.
4. Creates a draft GitHub Release and uploads the VSIX.
5. Publishes the same VSIX to the Visual Studio Marketplace with `vsce publish --oidc`.
6. Makes the GitHub Release public only after Marketplace publishing succeeds.

If Marketplace publishing fails, the GitHub Release remains a draft. After correcting the trusted publishing policy, rerun the failed workflow. The release steps are safe to rerun because the VSIX upload replaces the draft asset and Marketplace publishing uses `--skip-duplicate`.

## Troubleshooting

- `GitHub Actions did not provide an OIDC token`: confirm the release job has `id-token: write`.
- `Marketplace OIDC token exchange failed`: confirm the publisher policy matches `sonmai/stacknav` and `.github/workflows/release.yml`.
- `Extension not found` or publisher authorization errors: confirm `package.json` uses publisher ID `sonmai` and the trusted policy belongs to that publisher.
