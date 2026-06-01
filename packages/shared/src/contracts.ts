import { z } from 'zod';

export const CapabilitySchema = z.enum([
  'workspace_read',
  'workspace_write',
  'shell_read',
  'shell_write',
  'git_read',
  'git_write',
  'network',
  'browser',
  'package_install',
  'service_install',
  'secrets_read',
  'skill_read',
  'skill_write',
]);

export type Capability = z.infer<typeof CapabilitySchema>;

export const ALL_CAPABILITIES = CapabilitySchema.options;

export function isCapability(value: unknown): value is Capability {
  return CapabilitySchema.safeParse(value).success;
}

const IsoDateStringSchema = z.string().datetime({ offset: true });

export const HelmrEventSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoDateStringSchema,
  source: z.enum(['cli', 'webhook', 'chat', 'cron', 'heartbeat', 'api']),
  principal: z.object({
    id: z.string().min(1),
    type: z.enum(['local-user', 'service-account', 'remote-user']),
    trustLevel: z.enum(['owner', 'trusted', 'limited', 'untrusted']),
  }),
  workspace: z.object({
    id: z.string().min(1),
    path: z.string().min(1),
  }),
  payload: z.object({
    text: z.string().min(1),
    attachments: z
      .array(
        z.object({
          name: z.string().min(1),
          uri: z.string().min(1),
          kind: z.string().min(1),
        }),
      )
      .optional(),
  }),
  requestedCapabilities: z.array(CapabilitySchema).default(['workspace_read']),
});

export type HelmrEvent = z.infer<typeof HelmrEventSchema>;
export type HelmrEventSource = HelmrEvent['source'];
export type PrincipalTrustLevel = HelmrEvent['principal']['trustLevel'];

export function parseHelmrEvent(input: unknown): HelmrEvent {
  return HelmrEventSchema.parse(input);
}

export const HelmrJobSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    workspaceId: z.string().min(1),
    status: z.enum([
      'queued',
      'planning',
      'awaiting_approval',
      'running',
      'succeeded',
      'failed',
      'cancelled',
    ]),
    lane: z.enum(['interactive', 'background', 'maintenance']),
    priority: z.number().int().min(0).max(100),
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().min(1),
    createdAt: IsoDateStringSchema,
    updatedAt: IsoDateStringSchema,
    leaseUntil: IsoDateStringSchema.optional(),
  })
  .superRefine((job, ctx) => {
    if (job.attempts > job.maxAttempts) {
      ctx.addIssue({
        code: 'custom',
        path: ['attempts'],
        message: 'attempts must not exceed maxAttempts',
      });
    }

    if (job.status === 'running' && !job.leaseUntil) {
      ctx.addIssue({
        code: 'custom',
        path: ['leaseUntil'],
        message: 'leaseUntil is required for running jobs',
      });
    }
  });

export type HelmrJob = z.infer<typeof HelmrJobSchema>;
export type JobStatus = HelmrJob['status'];
export type JobLane = HelmrJob['lane'];

export function parseHelmrJob(input: unknown): HelmrJob {
  return HelmrJobSchema.parse(input);
}

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['reason', 'read', 'write', 'command', 'browser', 'mcp', 'review']),
  agent: z.enum(['council', 'coding', 'research', 'fast', 'browser', 'none']),
  canRunInParallelWith: z.array(z.string()),
  requiredCapabilities: z.array(CapabilitySchema).min(1),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

const APPROVAL_GATED_CAPABILITIES = new Set<Capability>([
  'workspace_write',
  'shell_write',
  'git_write',
  'package_install',
  'service_install',
  'secrets_read',
  // Self-extension: writing a new skill/plugin or changing Helmr's own behavior
  // is a gated write — it must pass through human approval (trust-calibrated).
  'skill_write',
]);

export function isApprovalGatedCapability(capability: Capability): boolean {
  return APPROVAL_GATED_CAPABILITIES.has(capability);
}

export const HelmrPlanSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    summary: z.string().min(1),
    risk: z.enum(['low', 'medium', 'high']),
    requiresApproval: z.boolean(),
    steps: z.array(PlanStepSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const gated = plan.steps.some((step) =>
      step.requiredCapabilities.some(isApprovalGatedCapability),
    );

    if (gated && (!plan.requiresApproval || plan.risk === 'low')) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiresApproval'],
        message: 'approval-gated capabilities require approval and medium/high risk',
      });
    }
  });

export type HelmrPlan = z.infer<typeof HelmrPlanSchema>;
export type PlanRisk = HelmrPlan['risk'];

export function parseHelmrPlan(input: unknown): HelmrPlan {
  return HelmrPlanSchema.parse(input);
}

export const SwarmStatusSchema = z.enum(['planned', 'running', 'succeeded', 'failed']);
export type SwarmStatus = z.infer<typeof SwarmStatusSchema>;

export const SwarmTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export type SwarmTaskStatus = z.infer<typeof SwarmTaskStatusSchema>;

/**
 * A single fan-out unit of work within a research swarm. Persisted to SQLite so
 * the orchestrator and the Hatchery view observe the same state across
 * processes rather than relying on in-memory sharing.
 */
export const SwarmTaskSchema = z.object({
  id: z.string().min(1),
  swarmId: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  status: SwarmTaskStatusSchema,
  output: z.string().optional(),
  error: z.string().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export type SwarmTask = z.infer<typeof SwarmTaskSchema>;

/**
 * A research swarm: a wide request decomposed into parallel subtasks that are
 * executed concurrently and synthesized into a single answer.
 */
export const SwarmSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  request: z.string().min(1),
  subtasks: z.array(z.string().min(1)).min(1),
  status: SwarmStatusSchema,
  summary: z.string().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export type Swarm = z.infer<typeof SwarmSchema>;

export function parseSwarm(input: unknown): Swarm {
  return SwarmSchema.parse(input);
}

export const ToolReceiptSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    stepId: z.string().min(1),
    tool: z.string().min(1),
    capability: CapabilitySchema,
    input: z.unknown(),
    risk: z.enum(['low', 'medium', 'high']),
    approval: z.enum(['not_required', 'required', 'approved', 'denied']),
    createdAt: IsoDateStringSchema,
  })
  .superRefine((receipt, ctx) => {
    if (isApprovalGatedCapability(receipt.capability) && receipt.approval === 'not_required') {
      ctx.addIssue({
        code: 'custom',
        path: ['approval'],
        message: 'approval-gated capabilities cannot use not_required approval',
      });
    }
  });

export const ToolResultSchema = z.object({
  id: z.string().min(1),
  receiptId: z.string().min(1),
  jobId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  output: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: IsoDateStringSchema,
});

export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ApprovalStatus = ToolReceipt['approval'];

export function parseToolReceipt(input: unknown): ToolReceipt {
  return ToolReceiptSchema.parse(input);
}
