# Uncontain

> **Note:** The contents of this repository were created with the support of AI.

A Firefox extension for people who use [containers](https://support.mozilla.org/kb/containers): **a URL you type into the address bar opens outside the container** (in the default "No Container" environment), while everything the page itself causes stays inside the current container.

## Why

With Multi-Account Containers it is easy to end up browsing unrelated sites inside, say, your *Shopping* or *Work* container just because you typed a new address into a container tab. Uncontain breaks that out automatically, but leaves alone anything the page triggers itself:

- link clicks and form posts
- HTTP 30x and JavaScript redirects
- OAuth / SSO logins, 3-D Secure and payment-provider handovers

## How it works

A navigation started by a page carries the initiating document (`originUrl` / `documentUrl`). A URL entered in the address bar has neither. When Uncontain sees a top-level `GET` request without an initiator in a container tab, it cancels the request before it is sent and opens the URL in a new tab in the default container. Redirect hops inherit the initiator, so payment and login flows are never touched.

To avoid false positives, it also skips:

- the first seconds after browser start (session restore)
- freshly opened tabs (e.g. Multi-Account Containers reopening an assigned site)
- URLs already visited in that tab (reload, back/forward)
- typed URLs on the **same site** as the current page (optional, on by default)
- hosts on your allowlist

If another container extension (Multi-Account Containers, Container Redirect, …) opens the typed URL itself within a short window, Uncontain stands down, so you get one tab in the right container instead of two.

## Installation

1. Download `uncontain.xpi` from the [latest release](../../releases/latest), or build it yourself (see below).
2. In Firefox open `about:addons`, click the gear icon → **Install Add-on From File…** and choose the `.xpi`.

Requires Firefox 140 or newer. Firefox release builds only install signed add-ons; unsigned builds can be loaded temporarily via `about:debugging` → **This Firefox** → **Load Temporary Add-on…**, or permanently in Firefox Developer Edition / Nightly / ESR with `xpinstall.signatures.required = false`.

## Settings

`about:addons` → **Uncontain** → **Options**

| Setting | Default | Meaning |
| --- | --- | --- |
| Mode | Preempt | *Preempt* cancels the request before the container loads anything. *Commit* uses the navigation transition type instead (fallback). |
| Only break out when the typed site differs | on | Typing another URL of the same site stays in the container. |
| Keep the container tab open | on | Off: the container tab closes once the new tab opens. |
| Host allowlist | – | Hosts that never break out (one per line, subdomains included). |
| Stand-down window for other container extensions | 700 ms | 0 = always open our own tab. |
| New-tab grace period | 2000 ms | Ignore container tabs younger than this. |
| Startup grace period | 5000 ms | Ignore everything right after startup. |
| Verbose logging | off | Logs to the add-on console (`about:debugging` → Inspect). |

## Permissions

`tabs`, `cookies`, `webRequest`, `webRequestBlocking`, `webNavigation`, `storage` and `<all_urls>` are needed to inspect top-level navigations, cancel them and reopen them in another container. The extension collects no data and makes no network requests of its own.

## Building

```sh
./build.sh
```

This creates `uncontain.xpi` (a plain ZIP of the extension files) in the repository root.

## License

[MIT](LICENSE)
