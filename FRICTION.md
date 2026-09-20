# Friction log

Contemporaneous record of where the platform fought back. Written as it happens,
never reconstructed — the exact error string is the part that makes an entry
useful, and it is the first thing memory loses.

Six fields per entry, per the hackathon's format. If nothing went wrong on a
given task, there is no entry. An empty section is an honest section.

---

## Template

### <n>. <one-line title>

- **Task attempted:**
- **Steps taken:**
- **Expected result:**
- **Actual result:** *(verbatim — paste the error, do not paraphrase it)*
- **Severity:** Critical / High / Medium / Low
- **Workaround:**
- **Actionable suggestion:**

---

## Entries

### 1. macOS prerequisites are overstated; the installer needs far less

- **Task attempted:** Install Vega Developer Tools on a clean macOS 26.5.2
  (Apple Silicon) machine with no Homebrew and no admin session.
- **Steps taken:** Read the documented prerequisites at
  `developer.amazon.com/docs/vega/0.23/install-vega-sdk.html`, which require
  Homebrew, Rosetta 2 via `softwareupdate --install-rosetta`, and nine packages
  (`binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`). Before
  running any of it, inspected `get_vvm.sh` directly.
- **Expected result:** All of the above genuinely needed before the SDK
  installer will run.
- **Actual result:** The installer's own prerequisite gate (`_001_check_prereqs`)
  hard-requires only **curl, tar and jq**. Its exact failure text for the one
  missing on a clean Mac is:
  `jq is required. Please install jq and ensure it is on the PATH.`
  There is **no `sudo` call anywhere in the macOS path** — the two `sudo`
  mentions in the script are printf help text for Ubuntu/snap. Installing the
  standalone `jq` binary to `~/.local/bin` and running
  `NONINTERACTIVE=true bash get_vvm.sh` completed successfully: SDK 0.24.12044
  installed to `~/vega`, VVD included, without Homebrew, without Rosetta, and
  without ever entering a password.
- **Severity:** Medium. Not a blocker, but it wrongly tells developers without
  admin rights on a managed machine that they cannot start — and Rosetta 2 is
  requested on Apple Silicon without the docs saying which component needs it.
- **Workaround:** Install `jq` standalone, then
  `NONINTERACTIVE=true bash get_vvm.sh`.
- **Actionable suggestion:** Split the prerequisites into "required to install"
  (curl, tar, jq) and "required to build" (the GNU toolchain, watchman), and say
  plainly that the macOS installer needs no elevated privileges. Documenting
  `NONINTERACTIVE=true` on the install page would also help CI setups — it is
  supported by the script but appears nowhere in the docs.

### 2. Documented React Native version does not match what the SDK generates

- **Task attempted:** Confirm the React Native version to target before writing
  any component code.
- **Steps taken:** The Vega documentation states React Native for Vega is based
  on React Native 0.72, and the API reference is published under a
  `/docs/react-native-vega/0.72/` path. Installed SDK 0.24.12044 and ran
  `vega project list-templates`, then generated with the default `helloWorld`
  template and read the resulting `package.json`.
- **Expected result:** A project targeting React Native 0.72.
- **Actual result:** Two templates are offered — `helloWorld` (targets RN v0.83)
  and `helloWorld-rn72` (targets RN v0.72). The default produced
  `react-native: 0.83.0`, `react: 19.2.0`,
  `@amazon-devices/react-native-kepler: ~4.0.0`, `engines.node: >=20`.
- **Severity:** Medium. Version-specific documentation reachable without a
  version selector means a developer can plan an entire component architecture
  against a runtime two years out of date. Third-party write-ups repeat the 0.72
  figure as current.
- **Workaround:** Trust the generated `package.json` over the prose docs, and
  read the `.d.ts` files in `node_modules` as the authority.
- **Actionable suggestion:** Surface the RN version each SDK release targets in
  the release notes and on the overview page, with the older pages clearly
  labelled by SDK version rather than by RN version.
