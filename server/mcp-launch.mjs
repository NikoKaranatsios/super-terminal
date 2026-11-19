import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Writes the MCP client entry next to an agent credential. The credential
// itself stays in the private config file named by SUPER_TERMINAL_AGENT_CONFIG.
export function agentMcp(configPath) {
  const spec = { command: process.execPath, args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))], env: { SUPER_TERMINAL_AGENT_CONFIG: configPath } };
  const configFile = configPath.endsWith('.json') ? configPath.replace(/\.json$/, '.mcp.json') : configPath + '.mcp.json';
  fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { super_terminal: spec } }), { mode: 0o600 });
  return { ...spec, configFile };
}

function tomlString(value) { return JSON.stringify(String(value)); }

// Grok reads MCP servers from <cwd>/.grok/config.toml. Never write the user-wide
// ~/.grok/config.toml, and keep an existing project file's other servers.
export function writeGrokProjectMcp(cwd, mcp) {
  if (!cwd || cwd === '~' || !mcp?.command) return null;
  const root = path.resolve(cwd);
  const userConfig = path.resolve(os.homedir(), '.grok', 'config.toml');
  const file = path.join(root, '.grok', 'config.toml');
  if (root === path.resolve(os.homedir()) || path.resolve(file) === userConfig) return null;
  const block = [
    '[mcp_servers.super_terminal]',
    `command = ${tomlString(mcp.command)}`,
    `args = [${(mcp.args || []).map(tomlString).join(', ')}]`,
    `env = { ${Object.entries(mcp.env || {}).map(([key, value]) => `${key} = ${tomlString(value)}`).join(', ')} }`,
    'enabled = true',
    ''
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = current.includes('[mcp_servers.super_terminal]')
    ? current.replace(/\[mcp_servers\.super_terminal\][\s\S]*?(?=\n\[|\s*$)/, block.trimEnd() + '\n')
    : (current.trim() ? current.trimEnd() + '\n\n' + block : block);
  fs.writeFileSync(file, next.endsWith('\n') ? next : next + '\n', { mode: 0o600 });
  return file;
}
