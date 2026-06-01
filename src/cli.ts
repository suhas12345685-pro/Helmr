#!/usr/bin/env node
import { resolve } from 'node:path';
import { runJob } from './runtime.js';
import { runSelfTest, printSelfTestResults } from './self-test.js';
import { startDaemon, stopDaemon, daemonStatus } from './daemon.js';
import { getHelmrPaths } from './paths.js';
import { loadPersistedSecrets } from './secrets.js';
import { formatServiceInstallPlan, installHelmrService, type ServiceInstallTarget } from './service-install.js';

const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

function printUsage(): void {
  console.log(`
Helmr - AI agent orchestration system

Usage:
  helmr ask <text>            Run a job with the given text request
  helmr onboard               Onboard and set up a new Helmr installation
  helmr status                Show runtime status
  helmr self-test             Run system health checks
  helmr start                 Start Gateway and Hatchery daemons
  helmr start gateway         Start the Gateway daemon
  helmr start hatchery        Start the Hatchery dashboard and UI
  helmr start all             Start Gateway and Hatchery daemons
  helmr stop                  Stop all background daemons
  helmr channels add          Add a new communication channel
  helmr install-service        Install user-level service integration
  helmr help                  Show this help

Options:
  --workspace <path>          Workspace path (defaults to current directory)

Examples:
  helmr ask "summarize this workspace and identify next development steps"
  helmr ask "what tests are missing?" --workspace /path/to/project
  helmr onboard
  helmr start
  helmr start gateway
  helmr start hatchery
  helmr stop
  helmr channels add --channel slack-support --method Slack
  helmr install-service --wsl2 --dry-run
  helmr install-service --windows --dry-run
  helmr self-test
`);
}

function parseArgs(argv: string[]): { text: string; workspace?: string } | null {
  const textParts: string[] = [];
  let workspace: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' && argv[i + 1]) {
      workspace = argv[++i];
    } else if (arg && !arg.startsWith('--')) {
      textParts.push(arg);
    }
  }

  if (textParts.length === 0) return null;
  return { text: textParts.join(' '), workspace };
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (command === 'onboard') {
    const { spawn } = await import('node:child_process');
    console.log('Starting Helmr onboarding wizard...');
    const child = spawn('npm', ['exec', 'create-helmr@latest'], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  if (command === 'status') {
    console.log('Helmr runtime: local');
    console.log(`Node: ${process.versions.node}`);
    console.log(`Model: ${process.env['HELMR_MODEL'] ?? 'configure during onboarding'}`);
    console.log(`Workspace: ${process.cwd()}`);
    console.log('-'.repeat(40));
    await daemonStatus('all');
    process.exit(0);
  }

  if (command === 'self-test') {
    const results = await runSelfTest();
    printSelfTestResults(results);
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  }

  if (command === 'start') {
    if (!subCommand || subCommand === 'all') {
      await startDaemon({}, 'all');
      return;
    }
    if (subCommand === 'gateway') {
      await startDaemon({}, 'gateway');
      return;
    }
    if (subCommand === 'hatchery') {
      await startDaemon({}, 'hatchery');
      return;
    }
    console.error(`Unknown start service: ${subCommand}`);
    printUsage();
    process.exit(1);
  }

  if (command === 'stop') {
    await stopDaemon('all');
    return;
  }

  if (command === 'hatchery') {
    const url = 'http://localhost:4000';
    console.log(`Opening Hatchery WebUI: ${url}`);
    const { exec } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? `start ${url}` :
      process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(openCmd, (err) => {
      if (err) console.log(`Could not open browser. Visit ${url} manually.`);
    });
    return;
  }


  if (command === 'install-service') {
    const target: ServiceInstallTarget | undefined = args.includes('--windows')
      ? 'windows'
      : args.includes('--wsl2')
        ? 'wsl2'
        : process.platform === 'win32'
          ? 'windows'
          : 'wsl2';
    const dryRun = args.includes('--dry-run');
    const plan = await installHelmrService({ target, dryRun });
    console.log(formatServiceInstallPlan(plan));
    if (dryRun) {
      console.log('Dry run only: no service files were written and no service command was executed.');
    } else if (target === 'wsl2') {
      console.log('Run the listed systemctl commands to enable and start Helmr.');
    } else {
      console.log('Run the listed schtasks commands in PowerShell to register and start Helmr.');
    }
    return;
  }

  if (command === 'channels') {
    if (subCommand === 'add') {
      let channelName = '';
      let methodName = '';
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
          channelName = args[++i];
        } else if (args[i] === '--method' && args[i + 1]) {
          methodName = args[++i];
        }
      }

      if (!channelName || !methodName) {
        console.error('Error: both --channel and --method parameters are required.');
        console.error('Usage: helmr channels add --channel <name> --method <method>');
        process.exit(1);
      }

      try {
        const { ConfigFileManager } = await import('../packages/config/src/config-files.js');
        const configDir = getHelmrPaths().configDir;
        const manager = new ConfigFileManager(configDir);
        await manager.init();

        const currentContent = await manager.read('CHANNELS.md');
        const newBlock = `
## ${channelName}
Status: active
Method: ${methodName}
Created: ${new Date().toISOString()}
`;
        await manager.write('CHANNELS.md', currentContent + newBlock);

        console.log(`[OK] Channel "${channelName}" successfully added via ${methodName}!`);
        process.exit(0);
      } catch (err) {
        console.error(`Error adding channel: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    } else {
      console.error(`Unknown channels subcommand: ${subCommand}`);
      console.log('Usage: helmr channels add --channel <name> --method <method>');
      process.exit(1);
    }
  }

  if (command === 'ask') {
    const parsed = parseArgs(args.slice(1));

    if (!parsed) {
      console.error('Error: no request text provided');
      console.error('Usage: helmr ask "your request here"');
      process.exit(1);
    }

    const workspacePath = parsed.workspace ? resolve(parsed.workspace) : process.cwd();

    // Restore persisted provider keys so a configured model is used (not the
    // local fallback) even in a fresh CLI process.
    await loadPersistedSecrets();

    console.log('');
    console.log('Helmr');
    console.log('-'.repeat(60));
    console.log(`Request: ${parsed.text}`);
    console.log(`Workspace: ${workspacePath}`);
    console.log('-'.repeat(60));
    console.log('');

    try {
      const result = await runJob({
        text: parsed.text,
        workspacePath,
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      console.log('');
      console.log('-'.repeat(60));
      console.log(`Job: ${result.jobId}`);
      console.log(`Status: ${result.status}`);
      console.log(`Plan: ${result.plan?.summary ?? 'N/A'}`);
      console.log(`Risk: ${result.plan?.risk ?? 'low'}`);
      console.log('-'.repeat(60));
      console.log('');

      if (result.status === 'awaiting_approval') {
        console.log('Awaiting review approval:');
        for (const reason of result.deniedReasons ?? []) {
          console.log(`  - ${reason}`);
        }
        process.exit(0);
      }

      if (result.status === 'denied') {
        console.log('Denied by policy:');
        for (const reason of result.deniedReasons ?? []) {
          console.log(`  - ${reason}`);
        }
        process.exit(1);
      }

      if (result.status === 'failed') {
        console.log('Job failed.');
        process.exit(1);
      }

      console.log(result.answer);
      console.log('');
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
