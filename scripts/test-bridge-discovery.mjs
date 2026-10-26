// Regression for the desktop port mismatch: the desktop host binds an
// OS-assigned port (--port 0), so bridge.py must follow the runtime file the
// plugin publishes instead of trusting a static base_url.
// Skipped when Python is unavailable, since the Codex skill requires it anyway.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bridge = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'deepseek-harness', 'scripts', 'bridge.py')
const python = process.env.PYTHON ?? 'python'
const probe = await new Promise((resolve) => {
  const child = spawn(python, ['--version'], { stdio: 'ignore' })
  child.on('error', () => resolve(false))
  child.on('exit', (code) => resolve(code === 0))
})
if (!probe) {
  console.log('SKIP: python unavailable; bridge.py discovery not exercised')
  process.exit(0)
}

const token = 'dshb_test-discovery-token'
const env = { ...process.env }
for (const key of ['DSH_CODEX_BRIDGE_URL', 'DSH_CODEX_BRIDGE_RUNTIME_FILE', 'DSH_CODEX_BRIDGE_TOKEN', 'DSH_CODEX_BRIDGE_TOKEN_FILE']) delete env[key]

const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-discovery-'))
const stateDir = join(dir, 'state')
const configDir = join(dir, 'skill', 'references')
const configPath = join(configDir, 'local-settings.json')
const tokenFile = join(stateDir, 'token')
const runtimeFile = join(stateDir, 'runtime.json')
await mkdir(stateDir, { recursive: true })
await mkdir(configDir, { recursive: true })
await writeFile(tokenFile, token + '\n')

const server = createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + token) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'auth/missing-token' } }))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, protocolVersion: 1, value: { bridge: 'ready', pid: process.pid } }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port + '/codex-bridge'

// Stands in for an unrelated service that later received a stale bridge port.
const wrongServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<html>not the bridge</html>')
})
await new Promise((resolve) => wrongServer.listen(0, '127.0.0.1', resolve))
const wrongBase = 'http://127.0.0.1:' + wrongServer.address().port + '/codex-bridge'

const runBridge = (settings) => new Promise((resolve) => {
  writeFile(configPath, JSON.stringify(settings)).then(() => {
    const child = spawn(python, [bridge, 'GET', '/health', '--config', configPath], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ status: -1, stdout, stderr: String(error) }))
    child.on('exit', (code) => resolve({ status: code, stdout, stderr }))
  })
})

const published = (url) => writeFile(runtimeFile, JSON.stringify({ version: 1, baseUrl: url, port: Number(new URL(url).port) }))

try {
  // 1. The bug: a stale configured port must not win over the published one.
  await published(base)
  let result = await runBridge({ base_url: 'http://127.0.0.1:1/codex-bridge', runtime_file: runtimeFile, token_file: tokenFile })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).value.bridge, 'ready')

  // 2. Legacy installations have no runtime_file field; the file sits beside the token.
  result = await runBridge({ base_url: 'http://127.0.0.1:1/codex-bridge', token_file: tokenFile })
  assert.equal(result.status, 0, result.stderr)

  // 3. A stale runtime file must not break a live configured URL.
  await published('http://127.0.0.1:1/codex-bridge')
  result = await runBridge({ base_url: base, runtime_file: runtimeFile, token_file: tokenFile })
  assert.equal(result.status, 0, result.stderr)

  // 4. Nothing reachable is a clear transport error, not a crash.
  result = await runBridge({ base_url: 'http://127.0.0.1:1/codex-bridge', runtime_file: runtimeFile, token_file: tokenFile })
  assert.equal(result.status, 3)
  assert.match(result.stderr, /Cannot reach the bridge/)
  assert.match(result.stderr, /tried http:\/\/127\.0\.0\.1:1\/codex-bridge/)

  // 5. A stale port reused by another HTTP service must fall through to the live URL.
  await published(wrongBase)
  result = await runBridge({ base_url: base, runtime_file: runtimeFile, token_file: tokenFile })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).value.bridge, 'ready')

  // 6. setup.mjs -Check prefers the published URL, then base_url, and an explicit
  // DSH_CODEX_BRIDGE_URL disables discovery entirely (mirrors bridge.py).
  const setup = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'setup.mjs')
  const codexHome = join(dir, 'codex')
  const references = join(codexHome, 'skills', 'deepseek-harness', 'references')
  await mkdir(references, { recursive: true })
  await writeFile(join(references, 'local-settings.json'), JSON.stringify({ base_url: 'http://127.0.0.1:1/codex-bridge', runtime_file: runtimeFile, token_file: tokenFile }))
  await published(wrongBase)
  const setupArgs = [setup, '--check', '--dsh-home', join(dir, 'dsh'), '--codex-home', codexHome]
  // Async spawn: the in-process fake servers answer while the check subprocess runs.
  const runSetup = (setupEnv) => new Promise((resolve) => {
    const child = spawn(process.execPath, setupArgs, { env: setupEnv })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ status: -1, stdout, stderr: String(error) }))
    child.on('exit', (code) => resolve({ status: code, stdout, stderr }))
  })
  const withoutEnv = await runSetup(env)
  assert.equal(withoutEnv.status, 1)
  assert.match(withoutEnv.stderr, /Cannot reach the bridge/)
  const withEnv = await runSetup({ ...env, DSH_CODEX_BRIDGE_URL: base })
  assert.equal(withEnv.status, 0, withEnv.stderr)
  assert.match(withEnv.stdout, /Bridge ready/)

  console.log('PASS: bridge.py follows the published port, falls back on stale ports, and setup.mjs -Check matches')
} finally {
  await new Promise((resolve) => wrongServer.close(resolve))
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
}
