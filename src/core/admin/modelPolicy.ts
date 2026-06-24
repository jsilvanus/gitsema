/**
 * Superadmin-gated model allow-lists (Phase 129 / locked-model-set-plan.md §5 Phase 2).
 *
 * Controls which *defined* embedding profiles and narrator/guide model configs
 * are *enabled* for use, at two scopes:
 *   - server-wide: applies to every caller, set by an operator (CLI-only, no
 *     network identity required — same trust tier as direct DB access).
 *   - org: narrows the server-wide set further for members of one org. Can
 *     never widen past the server-wide set — see `getEffectiveAllowedSet`.
 *
 * Policy is stored as JSON blobs in the existing `settings` key-value table
 * (no new schema/migration needed) under:
 *   `model_allowlist:server:<kind>`
 *   `model_allowlist:org:<orgId>:<kind>`
 *
 * Absence of a policy key means "default-allow-all" (today's Phase 128
 * behavior, unchanged) — this keeps the feature additive and backward
 * compatible. A policy only becomes restrictive once an operator/org_admin
 * makes its first `allow`/`deny` call.
 */

import type Database from 'better-sqlite3'
import { getSetting, setSetting, deleteSetting } from '../narrator/resolveNarrator.js'

export type ModelPolicyKind = 'embedding' | 'narrator' | 'guide'

export interface ModelAllowPolicy {
  /** False = default-allow-all (no explicit policy set yet). */
  active: boolean
  /** Enabled identifiers. Only meaningful when `active` is true. */
  names: string[]
}

const INACTIVE_POLICY: ModelAllowPolicy = { active: false, names: [] }

function serverKey(kind: ModelPolicyKind): string {
  return `model_allowlist:server:${kind}`
}

function orgKey(kind: ModelPolicyKind, orgId: number): string {
  return `model_allowlist:org:${orgId}:${kind}`
}

function readPolicy(rawDb: InstanceType<typeof Database>, key: string): ModelAllowPolicy {
  const raw = getSetting(rawDb, key)
  if (!raw) return INACTIVE_POLICY
  try {
    const parsed = JSON.parse(raw) as Partial<ModelAllowPolicy>
    if (!parsed.active) return INACTIVE_POLICY
    return { active: true, names: Array.isArray(parsed.names) ? parsed.names : [] }
  } catch {
    return INACTIVE_POLICY
  }
}

function writePolicy(rawDb: InstanceType<typeof Database>, key: string, policy: ModelAllowPolicy): void {
  setSetting(rawDb, key, JSON.stringify(policy))
}

export function getServerPolicy(rawDb: InstanceType<typeof Database>, kind: ModelPolicyKind): ModelAllowPolicy {
  return readPolicy(rawDb, serverKey(kind))
}

export function setServerPolicy(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  policy: ModelAllowPolicy,
): void {
  writePolicy(rawDb, serverKey(kind), policy)
}

export function getOrgPolicy(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  orgId: number,
): ModelAllowPolicy {
  return readPolicy(rawDb, orgKey(kind, orgId))
}

export function setOrgPolicy(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  orgId: number,
  policy: ModelAllowPolicy,
): void {
  writePolicy(rawDb, orgKey(kind, orgId), policy)
}

export function resetServerPolicy(rawDb: InstanceType<typeof Database>, kind: ModelPolicyKind): void {
  deleteSetting(rawDb, serverKey(kind))
}

export function resetOrgPolicy(rawDb: InstanceType<typeof Database>, kind: ModelPolicyKind, orgId: number): void {
  deleteSetting(rawDb, orgKey(kind, orgId))
}

/**
 * Adds `identifier` to `current`'s enabled set. If `current` was inactive
 * (default-allow-all), this is the first restrictive action and seeds an
 * opt-in set containing only `identifier` — staging a profile/config before
 * a wider rollout, per locked-model-set-plan.md §4.1. Returns `current`
 * unchanged (no-op) if `identifier` is already enabled.
 */
function applyAllow(current: ModelAllowPolicy, identifier: string): ModelAllowPolicy {
  if (!current.active) return { active: true, names: [identifier] }
  if (current.names.includes(identifier)) return current
  return { active: true, names: [...current.names, identifier] }
}

/**
 * Removes `identifier` from `current`'s enabled set. If `current` was
 * inactive, this is the first restrictive action and seeds an opt-out set
 * containing every other item in `seed` — denying one item without silently
 * disabling everything else (least surprise). `seed` is the full universe
 * for server-wide policy, or the server-effective allowed set for org policy
 * (an org can never re-enable something disabled server-wide).
 */
function applyDeny(current: ModelAllowPolicy, identifier: string, seed: string[]): ModelAllowPolicy {
  if (!current.active) return { active: true, names: seed.filter((n) => n !== identifier) }
  return { active: true, names: current.names.filter((n) => n !== identifier) }
}

/** Adds `identifier` to the server-wide enabled set for `kind`. */
export function allowServer(rawDb: InstanceType<typeof Database>, kind: ModelPolicyKind, identifier: string): void {
  const current = getServerPolicy(rawDb, kind)
  const next = applyAllow(current, identifier)
  if (next !== current) setServerPolicy(rawDb, kind, next)
}

/** Removes `identifier` from the server-wide enabled set for `kind`. `universe` seeds the opt-out set on first use. */
export function denyServer(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  identifier: string,
  universe: string[],
): void {
  setServerPolicy(rawDb, kind, applyDeny(getServerPolicy(rawDb, kind), identifier, universe))
}

/** Org-narrowing equivalent of `allowServer` — opt-in seeding for one org. */
export function allowOrg(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  orgId: number,
  identifier: string,
): void {
  const current = getOrgPolicy(rawDb, kind, orgId)
  const next = applyAllow(current, identifier)
  if (next !== current) setOrgPolicy(rawDb, kind, orgId, next)
}

/**
 * Org-narrowing equivalent of `denyServer`. `serverAllowedSet` is the
 * caller-computed effective server-wide set (already excludes anything
 * disabled server-wide) — the org's opt-out seed is relative to that, not
 * the full universe.
 */
export function denyOrg(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  orgId: number,
  identifier: string,
  serverAllowedSet: string[],
): void {
  setOrgPolicy(rawDb, kind, orgId, applyDeny(getOrgPolicy(rawDb, kind, orgId), identifier, serverAllowedSet))
}

/**
 * Resolves the effective allowed set of `universe` for `kind`, applying the
 * server-wide policy and then narrowing further by `orgId`'s policy (if any).
 * Org policy can only narrow — its result is always intersected with the
 * server-wide effective set, never unioned past it.
 */
export function getEffectiveAllowedSet(
  rawDb: InstanceType<typeof Database>,
  kind: ModelPolicyKind,
  orgId: number | null | undefined,
  universe: string[],
): string[] {
  const serverPolicy = getServerPolicy(rawDb, kind)
  const serverAllowed = serverPolicy.active ? universe.filter((n) => serverPolicy.names.includes(n)) : universe

  if (!orgId) return serverAllowed

  const orgPolicy = getOrgPolicy(rawDb, kind, orgId)
  if (!orgPolicy.active) return serverAllowed

  return serverAllowed.filter((n) => orgPolicy.names.includes(n))
}
