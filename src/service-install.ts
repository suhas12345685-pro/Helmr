import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type ServiceInstallTarget = 'windows' | 'wsl2';

export interface ServiceInstallPlan {
  target: ServiceInstallTarget;
  description: string;
  commands: string[];
  files: Array<{ path: string; content: string }>;
}

export interface InstallServiceOptions {
  target: ServiceInstallTarget;
  helmrBin?: string;
  homeDir?: string;
  dryRun?: boolean;
}

export function createServiceInstallPlan(options: InstallServiceOptions): ServiceInstallPlan {
  const helmrBin = options.helmrBin ?? 'helmr';
  if (options.target === 'windows') {
    return {
      target: 'windows',
      description: 'Register Helmr as a per-user Windows Task Scheduler startup task.',
      commands: [
        `schtasks /Create /TN Helmr /SC ONLOGON /TR "${helmrBin} start" /RL LIMITED /F`,
        'schtasks /Run /TN Helmr',
      ],
      files: [],
    };
  }

  const home = options.homeDir ?? homedir();
  const unitPath = join(home, '.config', 'systemd', 'user', 'helmr.service');
  const unit = `[Unit]
Description=Helmr self-hosted AI orchestrator
After=network-online.target

[Service]
Type=simple
ExecStart=${helmrBin} start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

  return {
    target: 'wsl2',
    description: 'Register Helmr as a user-level systemd service for WSL2/Linux.',
    commands: [
      `mkdir -p ${join(home, '.config', 'systemd', 'user')}`,
      `write ${unitPath}`,
      'systemctl --user daemon-reload',
      'systemctl --user enable --now helmr.service',
    ],
    files: [{ path: unitPath, content: unit }],
  };
}

export async function installHelmrService(options: InstallServiceOptions): Promise<ServiceInstallPlan> {
  const plan = createServiceInstallPlan(options);
  if (options.dryRun) return plan;

  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }

  return plan;
}

export function formatServiceInstallPlan(plan: ServiceInstallPlan): string {
  const fileLines = plan.files.map((file) => `  file: ${file.path}`);
  const commandLines = plan.commands.map((command) => `  command: ${command}`);
  return [
    `Helmr service install plan (${plan.target})`,
    plan.description,
    ...fileLines,
    ...commandLines,
  ].join('\n');
}
