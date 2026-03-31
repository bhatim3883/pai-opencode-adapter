# PAI OpenCode Adapter — Dependency Manifest

This document catalogs every external dependency required by PAI skills. Not all dependencies are required — only install what you need for the skills you use.

## Quick Start

The installer (`scripts/install.sh`) handles core setup. For optional skill dependencies, see the sections below.

---

## MCP Servers

MCP (Model Context Protocol) servers extend the adapter with external tool capabilities. Configure them in `~/.config/opencode/opencode.json` under `"mcpServers"`.

| Skill | MCP Server | Package | Required Env Var |
|-------|-----------|---------|------------------|
| Research (Retrieve) | BrightData | `@anthropic/bright-data-mcp` | `BRIGHT_DATA` |
| Research (Retrieve) | Apify | `@anthropic/apify-mcp` | `APIFY_TOKEN` |
| Scraping/BrightData | BrightData | `@anthropic/bright-data-mcp` | `BRIGHT_DATA` |
| Scraping/Apify | Apify | `@anthropic/apify-mcp` | `APIFY_TOKEN` |

### MCP Server Configuration Example

```json
{
  "mcpServers": {
    "brightdata": {
      "command": "npx",
      "args": ["-y", "@anthropic/bright-data-mcp"],
      "env": { "API_TOKEN": "<your BRIGHT_DATA value>" }
    },
    "apify": {
      "command": "npx",
      "args": ["-y", "@anthropic/apify-mcp"],
      "env": { "APIFY_TOKEN": "<your APIFY_TOKEN value>" }
    }
  }
}
```

---

## CLI Tools

### Core (Required)

These are checked by the installer and required for basic adapter operation.

| Tool | Install | Used By |
|------|---------|---------|
| `bun` | [bun.sh](https://bun.sh) | Build, test, runtime |
| `node` | `brew install node` | Runtime fallback |
| `jq` | `brew install jq` | JSON processing in hooks |
| `rg` (ripgrep) | `brew install ripgrep` | Code search |

### Documents & Media

| Tool | Install | Used By | Required? |
|------|---------|---------|-----------|
| `pandoc` | `brew install pandoc` | Documents skill — format conversion | If using Documents |
| `ffmpeg` | `brew install ffmpeg` | AudioEditor skill — audio/video processing | If using AudioEditor |
| `fabric` | [github.com/danielmiessler/fabric](https://github.com/danielmiessler/fabric) | Fabric skill — 240+ prompt patterns | If using Fabric |

### Security & Reconnaissance

| Tool | Install | Used By | Required? |
|------|---------|---------|-----------|
| `nmap` | `brew install nmap` | Security/Recon — port scanning | If using Recon |
| `subfinder` | `go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest` | Security/Recon — subdomain enumeration | If using Recon |
| `httpx` | `go install github.com/projectdiscovery/httpx/cmd/httpx@latest` | Security/Recon — HTTP probing | If using Recon |
| `nuclei` | `go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest` | Security/Recon — vulnerability scanning | If using Recon |
| `shodan` | `pipx install shodan` | Security/OSINT — Shodan CLI | If using OSINT |

### Infrastructure

| Tool | Install | Used By | Required? |
|------|---------|---------|-----------|
| `wrangler` | `npm install -g wrangler` | Cloudflare skill — Workers deployment | If using Cloudflare |
| `playwright` | `npx playwright install` | Browser skill — browser automation | If using Browser |

### Data Processing

| Tool | Install | Used By | Required? |
|------|---------|---------|-----------|
| `yq` | `brew install yq` | YAML processing in various skills | Recommended |

---

## API Keys

Store these in `~/.config/PAI/.env` (the adapter's env loader injects them into `process.env` at startup). Format: `KEY=value`, one per line.

| Key | Used By | How to Get |
|-----|---------|-----------|
| `APIFY_TOKEN` | Scraping/Apify, Research | [apify.com](https://apify.com) |
| `BRIGHT_DATA` | Scraping/BrightData, Research | [brightdata.com](https://brightdata.com) |
| `SHODAN_API_KEY` | Security/OSINT | [shodan.io](https://shodan.io) |
| `IPINFO_API_KEY` | Security/Recon | [ipinfo.io](https://ipinfo.io) |
| `CENSYS_API_SECRET` | Security/OSINT | [censys.io](https://censys.io) |
| `HUNTER_API_KEY` | Investigation/OSINT | [hunter.io](https://hunter.io) |
| `VIRUSTOTAL_API_KEY` | Security/OSINT | [virustotal.com](https://virustotal.com) |
| `FRED_API_KEY` | USMetrics | [fred.stlouisfed.org](https://fred.stlouisfed.org) |
| `GOOGLE_API_KEY` | Media/Art (Gemini image gen) | [console.cloud.google.com](https://console.cloud.google.com) |
| `GEMINI_API_KEY` | Parser (Gemini analysis) | [console.cloud.google.com](https://console.cloud.google.com) |
| `ELEVENLABS_API_KEY` | Voice notifications, AudioEditor | [elevenlabs.io](https://elevenlabs.io) |
| `CLEANVOICE_API_KEY` | AudioEditor (cloud polish) | [cleanvoice.ai](https://cleanvoice.ai) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare skill | [dash.cloudflare.com](https://dash.cloudflare.com) |

---

## Go Toolchain

Several security tools require Go for installation:

```bash
# Install Go (if not already installed)
brew install go

# Ensure ~/go/bin is in your PATH
echo 'export PATH="$HOME/go/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## Python Toolchain

The `shodan` CLI requires Python. Use `pipx` for isolated installation:

```bash
# Install pipx (if not already installed)
brew install pipx
pipx ensurepath

# Install shodan
pipx install shodan
```

---

## Verification

Run this to check which dependencies are installed:

```bash
echo "=== Core ===" && \
for cmd in bun node jq rg; do printf "%-12s %s\n" "$cmd" "$(which $cmd 2>/dev/null || echo 'NOT FOUND')"; done && \
echo "=== Documents & Media ===" && \
for cmd in pandoc ffmpeg fabric; do printf "%-12s %s\n" "$cmd" "$(which $cmd 2>/dev/null || echo 'NOT FOUND')"; done && \
echo "=== Security ===" && \
for cmd in nmap subfinder httpx nuclei shodan; do printf "%-12s %s\n" "$cmd" "$(which $cmd 2>/dev/null || echo 'NOT FOUND')"; done && \
echo "=== Infrastructure ===" && \
for cmd in wrangler yq; do printf "%-12s %s\n" "$cmd" "$(which $cmd 2>/dev/null || echo 'NOT FOUND')"; done && \
echo "=== API Keys ===" && \
for key in APIFY_TOKEN BRIGHT_DATA SHODAN_API_KEY IPINFO_API_KEY FRED_API_KEY GOOGLE_API_KEY GEMINI_API_KEY ELEVENLABS_API_KEY; do \
  printf "%-20s %s\n" "$key" "$([ -n "${!key}" ] && echo 'SET' || echo 'NOT SET')"; done
```
