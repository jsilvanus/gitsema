/**
 * Orgs & repo-grant management routes (Phase 123 / multi-tenant-auth §5 Phase B).
 *
 * POST   /api/v1/orgs                       — create a team org
 * GET    /api/v1/orgs                       — list orgs the caller belongs to
 * POST   /api/v1/orgs/:orgId/members        — add a member (rejects on personal orgs)
 * DELETE /api/v1/orgs/:orgId/members/:userId — remove a member (rejects on personal orgs)
 * GET    /api/v1/orgs/:orgId/members        — list members
 * POST   /api/v1/repos/:repoId/grants       — grant a user a role on a repo
 * GET    /api/v1/repos/:repoId/grants       — list grants on a repo
 * DELETE /api/v1/repos/:repoId/grants/:userId — revoke a user's grant on a repo
 * POST   /api/v1/repos/:repoId/move-to-org  — move a repo to a different org
 *
 * All routes require a resolved `req.userId` (authMiddleware). Authorization
 * beyond that is checked per-route below: org-membership management requires
 * org_admin on the target org; grant management requires 'owner' on the repo
 * or org_admin on the repo's org.
 */

import { Router } from 'express'
import { z } from 'zod'
import { getRawDb } from '../../core/db/sqlite.js'
import { getUserByUsername } from '../../core/auth/identity.js'
import {
  createOrg,
  getOrgById,
  addOrgMember,
  removeOrgMember,
  listOrgMembers,
  listOrgsForUser,
  isOrgAdmin,
  PersonalOrgImmutableError,
} from '../../core/auth/orgs.js'
import {
  createGrant,
  revokeGrant,
  listGrants,
  resolveUserRepoAccess,
  moveRepoToOrg,
  getRepoOrgId,
  roleSatisfies,
} from '../../core/auth/grants.js'
import { recordAuditEvent } from '../../core/auth/auditLog.js'

function requireUserId(req: import('express').Request, res: import('express').Response): number | undefined {
  if (req.userId === undefined) {
    res.status(401).json({ error: 'Unauthorized' })
    return undefined
  }
  return req.userId
}

/** True if `userId` may manage grants on `repoId`: org_admin of the repo's org, or 'owner' grant on the repo itself. */
function canManageRepoGrants(rawDb: ReturnType<typeof getRawDb>, userId: number, repoId: string): boolean {
  const orgId = getRepoOrgId(rawDb, repoId)
  if (orgId !== null && isOrgAdmin(rawDb, orgId, userId)) return true
  return roleSatisfies(resolveUserRepoAccess(rawDb, userId, repoId), 'owner')
}

const CreateOrgSchema = z.object({ name: z.string().min(1) })
const AddMemberSchema = z.object({ username: z.string().min(1), role: z.enum(['org_admin', 'member']).optional() })
const CreateGrantSchema = z.object({
  username: z.string().min(1),
  role: z.enum(['read', 'write', 'owner']),
  branchPattern: z.string().nullable().optional(),
})
const MoveToOrgSchema = z.object({ orgId: z.number().int().nullable() })

export function orgsRouter(): Router {
  const router = Router()

  router.post('/', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const parsed = CreateOrgSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const rawDb = getRawDb()
    const org = createOrg(rawDb, parsed.data.name, 'team')
    addOrgMember(rawDb, org.id, userId, 'org_admin')
    res.json(org)
  })

  router.get('/', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    res.json({ orgs: listOrgsForUser(getRawDb(), userId) })
  })

  router.get('/:orgId/members', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const orgId = Number(req.params.orgId)
    if (!isOrgAdmin(getRawDb(), orgId, userId)) {
      res.status(403).json({ error: 'Requires org_admin on this org' })
      return
    }
    res.json({ members: listOrgMembers(getRawDb(), orgId) })
  })

  router.post('/:orgId/members', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const orgId = Number(req.params.orgId)
    if (!isOrgAdmin(getRawDb(), orgId, userId)) {
      res.status(403).json({ error: 'Requires org_admin on this org' })
      return
    }
    const parsed = AddMemberSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const rawDb = getRawDb()
    const target = getUserByUsername(rawDb, parsed.data.username)
    if (!target) {
      res.status(404).json({ error: `User '${parsed.data.username}' not found` })
      return
    }
    try {
      const membership = addOrgMember(rawDb, orgId, target.id, parsed.data.role ?? 'member')
      recordAuditEvent(rawDb, {
        actorUserId: userId,
        action: 'org.member.add',
        target: parsed.data.username,
        orgId,
      })
      res.json(membership)
    } catch (e) {
      if (e instanceof PersonalOrgImmutableError) {
        res.status(403).json({ error: e.message })
        return
      }
      throw e
    }
  })

  router.delete('/:orgId/members/:userId', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const orgId = Number(req.params.orgId)
    if (!isOrgAdmin(getRawDb(), orgId, userId)) {
      res.status(403).json({ error: 'Requires org_admin on this org' })
      return
    }
    const targetUserId = Number(req.params.userId)
    try {
      const rawDb = getRawDb()
      removeOrgMember(rawDb, orgId, targetUserId)
      recordAuditEvent(rawDb, {
        actorUserId: userId,
        action: 'org.member.remove',
        target: String(targetUserId),
        orgId,
      })
      res.json({ ok: true })
    } catch (e) {
      if (e instanceof PersonalOrgImmutableError) {
        res.status(403).json({ error: e.message })
        return
      }
      throw e
    }
  })

  return router
}

/** Mounted under /api/v1/repos — repo-scoped grant + org-move routes. */
export function repoGrantsRouter(): Router {
  const router = Router()

  router.get('/:repoId/grants', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const repoId = req.params.repoId
    if (!canManageRepoGrants(getRawDb(), userId, repoId)) {
      res.status(403).json({ error: 'Requires owner grant or org_admin on this repo' })
      return
    }
    res.json({ grants: listGrants(getRawDb(), repoId) })
  })

  router.post('/:repoId/grants', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const repoId = req.params.repoId
    if (!canManageRepoGrants(getRawDb(), userId, repoId)) {
      res.status(403).json({ error: 'Requires owner grant or org_admin on this repo' })
      return
    }
    const parsed = CreateGrantSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const rawDb = getRawDb()
    const target = getUserByUsername(rawDb, parsed.data.username)
    if (!target) {
      res.status(404).json({ error: `User '${parsed.data.username}' not found` })
      return
    }
    const grant = createGrant(rawDb, {
      userId: target.id,
      repoId,
      role: parsed.data.role,
      branchPattern: parsed.data.branchPattern ?? null,
      grantedBy: userId,
    })
    recordAuditEvent(rawDb, {
      actorUserId: userId,
      action: 'grant.create',
      target: parsed.data.username,
      repoId,
    })
    res.json(grant)
  })

  router.delete('/:repoId/grants/:userId', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const repoId = req.params.repoId
    if (!canManageRepoGrants(getRawDb(), userId, repoId)) {
      res.status(403).json({ error: 'Requires owner grant or org_admin on this repo' })
      return
    }
    const targetUserId = Number(req.params.userId)
    const rawDb = getRawDb()
    const revoked = revokeGrant(rawDb, targetUserId, repoId)
    recordAuditEvent(rawDb, {
      actorUserId: userId,
      action: 'grant.revoke',
      target: String(targetUserId),
      repoId,
    })
    res.json({ revoked })
  })

  router.post('/:repoId/move-to-org', (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const repoId = req.params.repoId
    if (!canManageRepoGrants(getRawDb(), userId, repoId)) {
      res.status(403).json({ error: 'Requires owner grant or org_admin on the repo\'s current org' })
      return
    }
    const parsed = MoveToOrgSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    if (parsed.data.orgId !== null) {
      const org = getOrgById(getRawDb(), parsed.data.orgId)
      if (!org) {
        res.status(404).json({ error: `Org ${parsed.data.orgId} not found` })
        return
      }
    }
    const rawDb = getRawDb()
    moveRepoToOrg(rawDb, repoId, parsed.data.orgId)
    recordAuditEvent(rawDb, {
      actorUserId: userId,
      action: 'org.repo.moved',
      target: parsed.data.orgId !== null ? String(parsed.data.orgId) : 'null',
      repoId,
      orgId: parsed.data.orgId,
    })
    res.json({ ok: true })
  })

  return router
}
